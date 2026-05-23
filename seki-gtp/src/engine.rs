use std::sync::Arc;

use go_engine::{Stone, Turn};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tracing::{debug, info};

use crate::gtp::{seki_to_gtp, stone_to_gtp};

#[derive(Debug)]
pub enum MoveResult {
    Coord { col: u8, row: u8 },
    Pass,
    Resign,
}

#[derive(Clone)]
pub struct EngineHandle {
    inner: Arc<Mutex<EngineInner>>,
}

struct EngineInner {
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    _child: Child,
    boardsize: Option<(u8, u8)>,
}

impl EngineHandle {
    pub fn spawn(command: &str, args: &[String]) -> Result<Self, String> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to spawn engine: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open engine stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to open engine stdout".to_string())?;

        let reader = BufReader::new(stdout);

        Ok(EngineHandle {
            inner: Arc::new(Mutex::new(EngineInner {
                stdin,
                reader,
                _child: child,
                boardsize: None,
            })),
        })
    }

    pub async fn send_command(&self, cmd: &str) -> Result<String, String> {
        let mut inner = self.inner.lock().await;

        let line = format!("{cmd}\n");
        debug!("GTP >>> {line}");
        inner
            .stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write to engine: {e}"))?;
        inner
            .stdin
            .flush()
            .await
            .map_err(|e| format!("Failed to flush engine: {e}"))?;

        let mut response = String::new();
        loop {
            let mut line_buf = String::new();
            match inner.reader.read_line(&mut line_buf).await {
                Ok(0) => {
                    return Err("Engine closed stdin".to_string());
                }
                Ok(_) => {
                    let trimmed = line_buf.trim_end();
                    if trimmed == "\n" || trimmed.is_empty() {
                        break;
                    }
                    debug!("GTP <<< {trimmed}");
                    response.push_str(trimmed);
                    response.push('\n');
                }
                Err(e) => {
                    return Err(format!("Failed to read from engine: {e}"));
                }
            }
        }

        let response = response.trim().to_string();
        Ok(response)
    }

    pub async fn name(&self) -> Result<String, String> {
        let resp = self.send_command("name").await?;
        if let Some(stripped) = resp.strip_prefix('=') {
            Ok(stripped.trim().to_string())
        } else {
            Err(format!("'name' failed: {resp}"))
        }
    }

    pub async fn version(&self) -> Result<String, String> {
        let resp = self.send_command("version").await?;
        if let Some(stripped) = resp.strip_prefix('=') {
            Ok(stripped.trim().to_string())
        } else {
            Err(format!("'version' failed: {resp}"))
        }
    }

    pub async fn boardsize(&self, cols: u8, rows: u8) -> Result<(), String> {
        let resp = self.send_command(&format!("boardsize {cols}")).await?;
        if resp.starts_with('=') {
            let mut inner = self.inner.lock().await;
            inner.boardsize = Some((cols, rows));
            Ok(())
        } else {
            Err(format!("'boardsize' failed: {resp}"))
        }
    }

    pub async fn clear_board(&self) -> Result<(), String> {
        let resp = self.send_command("clear_board").await?;
        if resp.starts_with('=') {
            Ok(())
        } else {
            Err(format!("'clear_board' failed: {resp}"))
        }
    }

    pub async fn komi(&self, komi: f64) -> Result<(), String> {
        let resp = self.send_command(&format!("komi {komi}")).await?;
        if resp.starts_with('=') {
            Ok(())
        } else {
            Err(format!("'komi' failed: {resp}"))
        }
    }

    pub async fn play(&self, stone: Stone, gtp_coord: &str) -> Result<(), String> {
        let color = stone_to_gtp(stone);
        let resp = self
            .send_command(&format!("play {color} {gtp_coord}"))
            .await?;
        if resp.starts_with('=') {
            Ok(())
        } else {
            Err(format!("'play' failed: {resp}"))
        }
    }

    pub async fn set_free_handicap(&self, coords: &[String]) -> Result<(), String> {
        if coords.is_empty() {
            return Ok(());
        }
        let cmd = format!("set_free_handicap {}", coords.join(" "));
        let resp = self.send_command(&cmd).await?;
        if resp.starts_with('=') {
            Ok(())
        } else {
            Err(format!("'set_free_handicap' failed: {resp}"))
        }
    }

    pub async fn genmove(&self, stone: Stone) -> Result<MoveResult, String> {
        let color = stone_to_gtp(stone);
        let resp = self.send_command(&format!("genmove {color}")).await?;

        if !resp.starts_with('=') {
            return Err(format!("'genmove' failed: {resp}"));
        }

        let result = resp[1..].trim().to_uppercase();

        match result.as_str() {
            "PASS" => Ok(MoveResult::Pass),
            "RESIGN" => Ok(MoveResult::Resign),
            coord => {
                let board_size = {
                    let inner = self.inner.lock().await;
                    inner.boardsize.unwrap_or((19, 19)).0
                };
                let (col, row) = crate::gtp::gtp_to_seki(coord, board_size)
                    .ok_or_else(|| format!("Engine returned invalid coordinate: {coord}"))?;
                Ok(MoveResult::Coord { col, row })
            }
        }
    }

    pub async fn setup_position(&self, cols: u8, rows: u8, komi: f64) -> Result<(), String> {
        self.boardsize(cols, rows).await?;
        self.clear_board().await?;
        self.komi(komi).await?;
        Ok(())
    }

    pub async fn replay_moves(&self, moves: &[Turn]) -> Result<(), String> {
        for turn in moves {
            if turn.kind == go_engine::Move::Play {
                if let Some((col, row)) = turn.pos {
                    let board_size = {
                        let inner = self.inner.lock().await;
                        inner.boardsize.unwrap_or((19, 19)).0
                    };
                    let gtp_coord = seki_to_gtp(col, row, board_size);
                    self.play(turn.stone, &gtp_coord).await?;
                } else {
                    self.play(turn.stone, "pass").await?;
                }
            } else if turn.kind == go_engine::Move::Pass {
                self.play(turn.stone, "pass").await?;
            }
        }
        Ok(())
    }
}

pub async fn spawn_engine(command: &str, args: &[String]) -> Result<EngineHandle, String> {
    info!("[engine] spawning {command} {}", args.join(" "));
    let handle = EngineHandle::spawn(command, args)?;

    let name = handle.name().await?;
    let version = handle.version().await?;
    info!("[engine] {name} v{version}");

    Ok(handle)
}
