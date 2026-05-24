use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use go_engine::{Stone, Turn};
use seki_api_types::ws::{ClientMsg, LiveGameItem, ServerMsg};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

use crate::config::Config;
use crate::engine::{EngineHandle, MoveResult};

#[derive(Debug, Clone, PartialEq)]
enum GameStage {
    Idle,
    Challenge,
    Pregame,
    Playing,
    Territory,
    Finished,
}

struct GameState {
    stage: GameStage,
    our_stone: Option<Stone>,
    cols: u8,
    rows: u8,
    komi: f64,
    handicap: u8,
    moves_known: usize,
    pregame_accepted: bool,
    territory_approved: bool,
}

pub struct Bot {
    config: Config,
    engine: EngineHandle,
    ws_tx: mpsc::UnboundedSender<String>,
    games: HashMap<i64, GameState>,
    joined_games: Vec<i64>,
    challenge_queue: VecDeque<i64>,
    user_id: i64,
    game_gens: HashMap<i64, Arc<AtomicU64>>,
}

fn send_json(tx: &mpsc::UnboundedSender<String>, msg: &ClientMsg) {
    if let Ok(json) = serde_json::to_string(msg) {
        let _ = tx.send(json);
    }
}

impl Bot {
    pub async fn run(config: Config, engine: EngineHandle, user_id: i64) -> Result<(), String> {
        info!("Bot user_id={user_id} starting");

        let mut ws_handle =
            seki_client::ws::connect_with_retry(&config.server_url, &config.api_token).await;
        let ws_tx = ws_handle.tx.clone();

        let mut bot = Bot {
            config,
            engine,
            ws_tx,
            games: HashMap::new(),
            joined_games: Vec::new(),
            challenge_queue: VecDeque::new(),
            user_id,
            game_gens: HashMap::new(),
        };

        loop {
            tokio::select! {
                msg = ws_handle.rx.recv() => {
                    match msg {
                        Some(server_msg) => bot.handle_message(server_msg).await,
                        None => {
                            warn!("WebSocket channel closed, reconnecting...");
                            ws_handle = seki_client::ws::connect_with_retry(&bot.config.server_url, &bot.config.api_token).await;
                            bot.ws_tx = ws_handle.tx.clone();
                            bot.joined_games.clear();
                            bot.games.clear();
                        }
                    }
                }
            }
        }
    }

    async fn handle_message(&mut self, msg: ServerMsg) {
        match msg {
            ServerMsg::Init { player_games, .. } => {
                self.handle_init(player_games).await;
            }
            ServerMsg::GameCreated { game } => {
                self.handle_game_created(game).await;
            }
            ServerMsg::GameUpdated { game } => {
                self.handle_game_updated(game).await;
            }
            ServerMsg::GameRemoved { game_id } => {
                self.handle_game_removed(game_id).await;
            }
            ServerMsg::StateSync {
                game_id,
                stage,
                moves,
                current_turn_stone,
                black,
                white,
                komi,
                negotiations,
                territory,
                settings,
                ..
            } => {
                self.handle_state(
                    game_id,
                    &stage,
                    &serde_json::Value::Null,
                    &moves,
                    current_turn_stone,
                    &black,
                    &white,
                    komi,
                    &negotiations,
                    &territory,
                    settings.settings.handicap as u8,
                    settings.settings.cols as u8,
                    settings.settings.rows as u8,
                    true,
                )
                .await;
            }
            ServerMsg::State {
                game_id,
                stage,
                moves,
                current_turn_stone,
                black,
                white,
                komi,
                negotiations,
                territory,
                settings,
                ..
            } => {
                self.handle_state(
                    game_id,
                    &stage,
                    &serde_json::Value::Null,
                    &moves,
                    current_turn_stone,
                    &black,
                    &white,
                    komi,
                    &negotiations,
                    &territory,
                    settings.settings.handicap as u8,
                    settings.settings.cols as u8,
                    settings.settings.rows as u8,
                    false,
                )
                .await;
            }
            ServerMsg::UndoAccepted {
                game_id,
                current_turn_stone,
                ref moves,
                ..
            } => {
                self.handle_undo_accepted(game_id, current_turn_stone, moves)
                    .await;
            }
            ServerMsg::UndoRequestSent { game_id } => {
                self.handle_undo_request(game_id).await;
            }
            ServerMsg::UndoResponseNeeded { game_id, .. } => {
                self.handle_undo_request(game_id).await;
            }
            ServerMsg::Error {
                game_id, message, ..
            } => {
                error!("Server error for game {game_id:?}: {message}");
                if let Some(gid) = game_id
                    && self
                        .games
                        .get(&gid)
                        .map(|g| g.stage == GameStage::Challenge)
                        .unwrap_or(false)
                {
                    self.games.remove(&gid);
                    self.joined_games.retain(|&id| id != gid);
                }
            }
            ServerMsg::UndoRejected { .. }
            | ServerMsg::Chat { .. }
            | ServerMsg::PlayerDisconnected { .. }
            | ServerMsg::PlayerReconnected { .. }
            | ServerMsg::PlayerGone { .. }
            | ServerMsg::PresenceState { .. }
            | ServerMsg::PresenceChanged { .. } => {
                // Logged by server, no action needed
            }
        }
    }

    async fn handle_init(&mut self, player_games: Vec<LiveGameItem>) {
        for game in &player_games {
            if self.is_player(game) {
                match game.stage.as_str() {
                    "black_to_play" | "white_to_play" | "territory_review" => {
                        self.join_game(game.id).await;
                        let our_stone = if game.black.as_ref().is_some_and(|u| u.id == self.user_id)
                        {
                            Some(Stone::Black)
                        } else if game.white.as_ref().is_some_and(|u| u.id == self.user_id) {
                            Some(Stone::White)
                        } else {
                            None
                        };
                        let stage = match game.stage.as_str() {
                            "territory_review" => GameStage::Territory,
                            _ => GameStage::Playing,
                        };
                        self.games.entry(game.id).or_insert_with(|| GameState {
                            stage,
                            our_stone,
                            cols: game.settings.cols as u8,
                            rows: game.settings.rows as u8,
                            komi: game.derived_komi.unwrap_or(6.5),
                            handicap: game.settings.handicap as u8,
                            moves_known: game.move_count.unwrap_or(0),
                            pregame_accepted: false,
                            territory_approved: false,
                        });
                    }
                    _ => {}
                }
            }
        }
        for game in &player_games {
            if self.is_player(game) && game.stage == "challenge" {
                self.queue_or_accept_challenge(game.id);
            }
        }
    }

    async fn handle_game_created(&mut self, game: LiveGameItem) {
        if self.is_player(&game) {
            match game.stage.as_str() {
                "challenge" => {
                    self.queue_or_accept_challenge(game.id);
                }
                _ => {
                    self.join_game(game.id).await;
                }
            }
        }
    }

    async fn handle_game_updated(&mut self, game: LiveGameItem) {
        if let Some(gs) = self.games.get_mut(&game.id) {
            if game.stage == "challenge" && gs.stage == GameStage::Challenge {
                return;
            }
            match game.stage.as_str() {
                "completed" | "resigned" | "aborted" | "declined" | "timeout" => {
                    gs.stage = GameStage::Finished;
                }
                _ => {}
            }
        }
    }

    async fn handle_game_removed(&mut self, game_id: i64) {
        self.games.remove(&game_id);
        self.game_gens.remove(&game_id);
        self.joined_games.retain(|&id| id != game_id);
        self.process_challenge_queue().await;
    }

    fn is_player(&self, game: &LiveGameItem) -> bool {
        game.black.as_ref().is_some_and(|u| u.id == self.user_id)
            || game.white.as_ref().is_some_and(|u| u.id == self.user_id)
            || game.opponent.as_ref().is_some_and(|u| u.id == self.user_id)
    }

    fn queue_or_accept_challenge(&mut self, game_id: i64) {
        let active: usize = self
            .games
            .values()
            .filter(|g| {
                matches!(
                    g.stage,
                    GameStage::Playing | GameStage::Pregame | GameStage::Territory
                )
            })
            .count();
        if active < self.config.max_concurrent_games {
            info!("Challenge received, joining game game={game_id}");
            let _handle = tokio::spawn({
                let tx = self.ws_tx.clone();
                async move {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    send_json(&tx, &ClientMsg::join_game(game_id));
                }
            });
            self.games.insert(
                game_id,
                GameState {
                    stage: GameStage::Challenge,
                    our_stone: None,
                    cols: 19,
                    rows: 19,
                    komi: 6.5,
                    handicap: 0,
                    moves_known: 0,
                    pregame_accepted: false,
                    territory_approved: false,
                },
            );
            self.joined_games.push(game_id);
        } else {
            info!(
                "Challenge queue full (active={}, max={}), queuing game={}",
                active, self.config.max_concurrent_games, game_id
            );
            self.challenge_queue.push_back(game_id);
        }
    }

    async fn process_challenge_queue(&mut self) {
        while let Some(game_id) = self.challenge_queue.pop_front() {
            let active: usize = self
                .games
                .values()
                .filter(|g| {
                    matches!(
                        g.stage,
                        GameStage::Playing | GameStage::Pregame | GameStage::Territory
                    )
                })
                .count();
            if active >= self.config.max_concurrent_games {
                self.challenge_queue.push_front(game_id);
                info!(
                    "Cannot accept queued challenge game={game_id}, active={active}, max={}",
                    self.config.max_concurrent_games
                );
                break;
            }
            info!("Accepting queued challenge game={game_id}");
            let _handle = tokio::spawn({
                let tx = self.ws_tx.clone();
                async move {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    send_json(&tx, &ClientMsg::join_game(game_id));
                }
            });
            self.games.insert(
                game_id,
                GameState {
                    stage: GameStage::Challenge,
                    our_stone: None,
                    cols: 19,
                    rows: 19,
                    komi: 6.5,
                    handicap: 0,
                    moves_known: 0,
                    pregame_accepted: false,
                    territory_approved: false,
                },
            );
            self.joined_games.push(game_id);
        }
    }

    async fn join_game(&mut self, game_id: i64) {
        if self.joined_games.contains(&game_id) {
            return;
        }
        send_json(&self.ws_tx, &ClientMsg::join_game(game_id));
        self.joined_games.push(game_id);
    }

    #[allow(clippy::too_many_arguments)]
    async fn handle_state(
        &mut self,
        game_id: i64,
        stage: &str,
        _state: &serde_json::Value,
        moves: &[Turn],
        current_turn_stone: i32,
        black: &Option<seki_api_types::user::UserData>,
        white: &Option<seki_api_types::user::UserData>,
        komi: f64,
        negotiations: &Option<seki_api_types::game::Negotiations>,
        territory: &Option<seki_api_types::game::TerritoryState>,
        handicap: u8,
        cols: u8,
        rows: u8,
        _is_sync: bool,
    ) {
        let tx = self.ws_tx.clone();
        let delay_s = self.config.accept_delay_s;
        let finished = {
            let gs = self.games.entry(game_id).or_insert_with(|| GameState {
                stage: GameStage::Idle,
                our_stone: None,
                cols,
                rows,
                komi: 6.5,
                handicap: 0,
                moves_known: 0,
                pregame_accepted: false,
                territory_approved: false,
            });

            gs.cols = cols;
            gs.rows = rows;

            if gs.our_stone.is_none() {
                gs.our_stone = if black.as_ref().is_some_and(|u| u.id == self.user_id) {
                    Some(Stone::Black)
                } else if white.as_ref().is_some_and(|u| u.id == self.user_id) {
                    Some(Stone::White)
                } else {
                    None
                };
            }
            gs.komi = komi;
            if handicap > 0 {
                gs.handicap = handicap;
            }

            match stage {
                "challenge" => {
                    if gs.stage != GameStage::Finished {
                        gs.stage = GameStage::Challenge;
                        if delay_s > 0 {
                            info!("Challenge received, will accept in {delay_s}s game={game_id}");
                            let tx = tx.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(std::time::Duration::from_secs(delay_s)).await;
                                info!("Accepting challenge game={game_id}");
                                send_json(&tx, &ClientMsg::accept_challenge(game_id));
                            });
                        } else {
                            info!("Accepting challenge game={game_id}");
                            send_json(&tx, &ClientMsg::accept_challenge(game_id));
                        }
                    }
                }
                "unstarted" => {
                    if let Some(neg) = negotiations
                        && let Some(pg) = &neg.pregame_settings
                    {
                        gs.stage = GameStage::Pregame;
                        if !gs.pregame_accepted {
                            let opponent_approved = match gs.our_stone {
                                Some(Stone::Black) => pg.white_approved,
                                Some(Stone::White) => pg.black_approved,
                                None => false,
                            };
                            if opponent_approved {
                                info!("Accepting pregame settings game={game_id}");
                                gs.pregame_accepted = true;
                                send_json(
                                    &self.ws_tx,
                                    &ClientMsg::accept_pregame_settings(game_id),
                                );
                            }
                        }
                    }
                }
                "black_to_play" | "white_to_play" => {
                    let transitioning_to_play = gs.stage != GameStage::Playing;
                    gs.stage = GameStage::Playing;

                    let our_stone = gs.our_stone;
                    let expected_current = if our_stone == Some(Stone::Black) {
                        1
                    } else {
                        -1
                    };

                    if current_turn_stone == expected_current
                        && (moves.len() > gs.moves_known || transitioning_to_play)
                    {
                        let tx = self.ws_tx.clone();
                        let engine = self.engine.clone();
                        let cfg = self.config.clone();
                        let gs_cols = gs.cols;
                        let gs_rows = gs.rows;
                        let gs_komi = gs.komi;
                        let gs_handicap = gs.handicap;
                        let moves_vec = moves.to_vec();

                        let generation = self
                            .game_gens
                            .entry(game_id)
                            .or_insert_with(|| Arc::new(AtomicU64::new(0)))
                            .clone();
                        generation.fetch_add(1, Ordering::SeqCst);
                        let cancel_token = generation.load(Ordering::SeqCst);

                        tokio::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                            Bot::think_and_play(
                                engine,
                                tx,
                                game_id,
                                gs_cols,
                                gs_rows,
                                gs_komi,
                                &moves_vec,
                                our_stone,
                                gs_handicap,
                                &cfg,
                                generation,
                                cancel_token,
                            )
                            .await;
                        });
                    }
                }
                "territory_review" => {
                    gs.stage = GameStage::Territory;
                    if let Some(t) = territory
                        && !gs.territory_approved
                    {
                        let opponent_approved = match gs.our_stone {
                            Some(Stone::Black) => t.white_approved,
                            Some(Stone::White) => t.black_approved,
                            None => false,
                        };
                        if opponent_approved {
                            info!("Approving territory game={game_id}");
                            gs.territory_approved = true;
                            send_json(&self.ws_tx, &ClientMsg::approve_territory(game_id));
                        }
                    }
                }
                _ => {
                    if !matches!(gs.stage, GameStage::Finished) {
                        gs.stage = GameStage::Finished;
                        info!("Game {game_id} finished (stage={stage})");
                    }
                }
            }

            gs.moves_known = moves.len();
            matches!(gs.stage, GameStage::Finished)
        };

        if finished {
            self.games.remove(&game_id);
            self.game_gens.remove(&game_id);
            self.joined_games.retain(|&id| id != game_id);
            self.process_challenge_queue().await;
        }
    }

    async fn handle_undo_accepted(
        &mut self,
        game_id: i64,
        current_turn_stone: i32,
        moves: &[Turn],
    ) {
        let our_stone = self.games.get(&game_id).and_then(|g| g.our_stone);
        let expected_current = match our_stone {
            Some(Stone::Black) => 1,
            Some(Stone::White) => -1,
            None => 0,
        };
        info!(
            "Undo accepted for game={game_id}, current_turn_stone={current_turn_stone}, our_stone={our_stone:?}, expected_current={expected_current}"
        );

        if let Some(gs) = self.games.get_mut(&game_id) {
            gs.moves_known = moves.len();
        }

        let generation = self
            .game_gens
            .entry(game_id)
            .or_insert_with(|| Arc::new(AtomicU64::new(0)))
            .clone();
        generation.fetch_add(1, Ordering::SeqCst);

        if current_turn_stone == expected_current {
            info!("It is our turn after undo, playing game={game_id}");
            let tx = self.ws_tx.clone();
            let engine = self.engine.clone();
            let cfg = self.config.clone();
            let gs_cols;
            let gs_rows;
            let gs_komi;
            let gs_handicap;
            if let Some(gs) = self.games.get(&game_id) {
                gs_cols = gs.cols;
                gs_rows = gs.rows;
                gs_komi = gs.komi;
                gs_handicap = gs.handicap;
            } else {
                return;
            }

            let moves_vec = moves.to_vec();
            let cancel_token = generation.load(Ordering::SeqCst);

            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                Bot::think_and_play(
                    engine,
                    tx,
                    game_id,
                    gs_cols,
                    gs_rows,
                    gs_komi,
                    &moves_vec,
                    our_stone,
                    gs_handicap,
                    &cfg,
                    generation,
                    cancel_token,
                )
                .await;
            });
        }
    }

    async fn handle_undo_request(&mut self, game_id: i64) {
        info!("Auto-accepting undo request game={game_id}");
        send_json(&self.ws_tx, &ClientMsg::respond_to_undo(game_id, "accept"));
    }

    #[allow(clippy::too_many_arguments)]
    async fn think_and_play(
        engine: EngineHandle,
        tx: mpsc::UnboundedSender<String>,
        game_id: i64,
        cols: u8,
        rows: u8,
        komi: f64,
        moves: &[Turn],
        our_stone: Option<Stone>,
        handicap: u8,
        config: &Config,
        generation: Arc<AtomicU64>,
        cancel_token: u64,
    ) {
        let stone = match our_stone {
            Some(s) => s,
            None => {
                error!("Game {game_id}: unknown our stone");
                return;
            }
        };

        if generation.load(Ordering::SeqCst) != cancel_token {
            info!("Game {game_id}: stale think_and_play (gen changed), skipping");
            return;
        }

        if let Err(e) = engine.setup_position(cols, rows, komi).await {
            error!("Game {game_id}: setup failed - {e}. Falling back to pass.");
            send_json(&tx, &ClientMsg::pass(game_id));
            return;
        }

        if generation.load(Ordering::SeqCst) != cancel_token {
            info!("Game {game_id}: stale think_and_play after setup, skipping");
            return;
        }

        if handicap >= 2
            && let Some(pts) = go_engine::handicap::handicap_points(cols, rows, handicap)
        {
            let gtp_coords: Vec<String> = pts
                .iter()
                .map(|&(c, r)| crate::gtp::seki_to_gtp(c, r, cols))
                .collect();
            if let Err(e) = engine.set_free_handicap(&gtp_coords).await {
                error!("Game {game_id}: handicap placement failed - {e}. Falling back to pass.");
                send_json(&tx, &ClientMsg::pass(game_id));
                return;
            }
        }

        if generation.load(Ordering::SeqCst) != cancel_token {
            info!("Game {game_id}: stale think_and_play after handicap, skipping");
            return;
        }

        if let Err(e) = engine.replay_moves(moves).await {
            error!("Game {game_id}: replay failed - {e}. Falling back to pass.");
            send_json(&tx, &ClientMsg::pass(game_id));
            return;
        }

        if generation.load(Ordering::SeqCst) != cancel_token {
            info!("Game {game_id}: stale think_and_play after replay, skipping");
            return;
        }

        let move_result = tokio::time::timeout(
            std::time::Duration::from_millis(config.time.engine_timeout_ms),
            engine.genmove(stone),
        )
        .await;

        if generation.load(Ordering::SeqCst) != cancel_token {
            info!("Game {game_id}: stale think_and_play after genmove, skipping");
            return;
        }

        let move_result = match move_result {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => {
                error!("Game {game_id}: genmove failed - {e}. Falling back to pass.");
                send_json(&tx, &ClientMsg::pass(game_id));
                return;
            }
            Err(_) => {
                warn!("Game {game_id}: engine timeout. Falling back to pass.");
                send_json(&tx, &ClientMsg::pass(game_id));
                return;
            }
        };

        match move_result {
            MoveResult::Coord { col, row } => {
                info!("Game {game_id}: bot playing ({col},{row})");
                send_json(&tx, &ClientMsg::play(game_id, col as i32, row as i32));
            }
            MoveResult::Pass => {
                info!("Game {game_id}: bot passing");
                send_json(&tx, &ClientMsg::pass(game_id));
            }
            MoveResult::Resign => {
                info!("Game {game_id}: bot resigning");
                send_json(&tx, &ClientMsg::resign(game_id));
            }
        }
    }
}
