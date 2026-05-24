use std::collections::HashMap;

use go_engine::{GameState, Stone};
use rand::Rng;
use seki_api_types::ws::{ClientMsg, LiveGameItem, ServerMsg};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::action::{
    GameAction, pick_game_action, pick_random_move, random_chat_message, random_create_game_body,
};
use crate::config::Config;

struct ActiveGame {
    stage: String,
    our_stone: Option<Stone>,
    board: Option<GameState>,
    has_opponent: bool,
}

pub struct BotRunner {
    config: Config,
    bot_index: u32,
    ws_tx: mpsc::UnboundedSender<String>,
    http: seki_client::http::HttpClient,
    user_id: i64,
    my_games: HashMap<i64, ActiveGame>,
    lobby_games: Vec<i64>,
    rng: rand::rngs::StdRng,
}

fn send_json(tx: &mpsc::UnboundedSender<String>, msg: &ClientMsg) {
    if let Ok(json) = serde_json::to_string(msg) {
        if let Err(e) = tx.send(json) {
            warn!("[bot] failed to send WS message: {e}");
        }
    } else {
        warn!("[bot] failed to serialize message");
    }
}

impl BotRunner {
    pub async fn run(config: Config, bot_index: u32) -> Result<(), String> {
        let token = format!("random-bot-{bot_index}");
        let http = seki_client::http::HttpClient::new(&config.server_url, &token);

        info!("bot-{bot_index} connecting with token={token}");

        let mut ws_handle = seki_client::ws::connect_with_retry(&config.server_url, &token).await;

        let ws_tx = ws_handle.tx.clone();

        use rand::SeedableRng;
        let rng = rand::rngs::StdRng::from_os_rng();

        let mut bot = BotRunner {
            config,
            bot_index,
            ws_tx,
            http,
            user_id: 0,
            my_games: HashMap::new(),
            lobby_games: Vec::new(),
            rng,
        };

        let interval = bot.config.timing.action_interval_ms;
        let jitter = bot.config.timing.jitter_ms;
        // Stagger bots so they don't all fire at the same instant
        let stagger = bot.rng.random_range(0..=jitter);
        tokio::time::sleep(tokio::time::Duration::from_millis(stagger)).await;
        let mut tick_timer = tokio::time::interval(tokio::time::Duration::from_millis(interval));

        loop {
            tokio::select! {
                msg = ws_handle.rx.recv() => {
                    match msg {
                        Some(server_msg) => bot.handle_message(server_msg).await,
                        None => {
                            warn!("bot-{} WS channel closed, reconnecting...", bot.bot_index);
                            ws_handle = seki_client::ws::connect_with_retry(&bot.config.server_url, &token).await;
                            bot.ws_tx = ws_handle.tx.clone();
                            bot.my_games.clear();
                            bot.lobby_games.clear();
                        }
                    }
                }
                _ = tick_timer.tick() => {
                    let extra = bot.rng.random_range(0..=jitter);
                    tokio::time::sleep(tokio::time::Duration::from_millis(extra)).await;
                    bot.tick().await;
                }
            }
        }
    }

    fn bot_name(&self) -> String {
        format!("bot-{}", self.bot_index)
    }

    async fn handle_message(&mut self, msg: ServerMsg) {
        match msg {
            ServerMsg::Init {
                player_id,
                player_games,
                public_games,
            } => {
                self.user_id = player_id;
                info!("{} authenticated as user_id={}", self.bot_name(), player_id);

                for game in &player_games {
                    let gid = game.id;
                    self.my_games.entry(gid).or_insert_with(|| ActiveGame {
                        stage: game.stage.clone(),
                        our_stone: guess_stone(game, player_id),
                        board: None,
                        has_opponent: game.opponent.is_some(),
                    });
                    self.join_game(gid);
                    self.handle_game_stage_hook(gid).await;
                }

                for game in &public_games {
                    if !self.my_games.contains_key(&game.id) && is_joinable(game) {
                        self.lobby_games.push(game.id);
                    }
                }
            }
            ServerMsg::GameCreated { game } => {
                if self.my_games.contains_key(&game.id) {
                    self.lobby_games.retain(|&id| id != game.id);
                    let stage_before = self.my_games.get(&game.id).map(|g| g.stage.clone());
                    let had_opponent = self
                        .my_games
                        .get(&game.id)
                        .map(|g| g.has_opponent)
                        .unwrap_or(false);
                    let has_opponent = game.opponent.is_some();
                    if let Some(ag) = self.my_games.get_mut(&game.id) {
                        ag.stage = game.stage.clone();
                        ag.has_opponent = has_opponent;
                    }
                    if stage_before.as_deref() != Some(game.stage.as_str())
                        || (!had_opponent && has_opponent)
                    {
                        self.handle_game_stage_hook(game.id).await;
                    }
                } else if !game.settings.is_private && is_joinable(&game) {
                    self.lobby_games.push(game.id);
                }
            }
            ServerMsg::GameUpdated { game } => {
                let gid = game.id;
                if let Some(ag) = self.my_games.get_mut(&gid) {
                    let stage_before = ag.stage.clone();
                    let had_opponent = ag.has_opponent;
                    let has_opponent = game.opponent.is_some();
                    ag.stage = game.stage.clone();
                    ag.has_opponent = has_opponent;
                    if matches!(
                        game.stage.as_str(),
                        "completed" | "resigned" | "aborted" | "declined" | "timeout"
                    ) {
                        info!(
                            "{} game {gid} finished (stage={})",
                            self.bot_name(),
                            game.stage
                        );
                    }
                    if stage_before != game.stage || (!had_opponent && has_opponent) {
                        self.handle_game_stage_hook(gid).await;
                    }
                }
            }
            ServerMsg::GameRemoved { game_id } => {
                self.my_games.remove(&game_id);
                self.lobby_games.retain(|&id| id != game_id);
            }
            ServerMsg::StateSync {
                game_id,
                ref stage,
                ref state,
                current_turn_stone,
                ref black,
                ref white,
                komi: _,
                ..
            } => {
                let our_stone = if black.as_ref().is_some_and(|u| u.id == self.user_id) {
                    Some(Stone::Black)
                } else if white.as_ref().is_some_and(|u| u.id == self.user_id) {
                    Some(Stone::White)
                } else {
                    None
                };

                let is_our_turn_now = our_stone.is_some_and(|s| match s {
                    Stone::Black => current_turn_stone == 1,
                    Stone::White => current_turn_stone == -1,
                });

                let stage_before = self.my_games.get(&game_id).map(|g| g.stage.clone());
                let had_opponent = self
                    .my_games
                    .get(&game_id)
                    .map(|g| g.has_opponent)
                    .unwrap_or(false);
                let has_opponent = black.is_some() && white.is_some();
                self.my_games.entry(game_id).and_modify(|g| {
                    g.stage = stage.clone();
                    g.our_stone = our_stone;
                    g.board = Some(state.clone());
                    g.has_opponent = has_opponent;
                });

                if is_our_turn_now {
                    info!(
                        "{} our turn in game {game_id} (stage={stage})",
                        self.bot_name()
                    );
                }

                if stage_before.as_deref() != Some(stage.as_str())
                    || (!had_opponent && has_opponent)
                {
                    self.handle_game_stage_hook(game_id).await;
                }
            }
            ServerMsg::State {
                game_id,
                ref stage,
                ref state,
                current_turn_stone,
                ref black,
                ref white,
                komi: _,
                ..
            } => {
                let our_stone = if black.as_ref().is_some_and(|u| u.id == self.user_id) {
                    Some(Stone::Black)
                } else if white.as_ref().is_some_and(|u| u.id == self.user_id) {
                    Some(Stone::White)
                } else {
                    None
                };

                let is_our_turn_now = our_stone.is_some_and(|s| match s {
                    Stone::Black => current_turn_stone == 1,
                    Stone::White => current_turn_stone == -1,
                });

                let stage_before = self.my_games.get(&game_id).map(|g| g.stage.clone());
                let had_opponent = self
                    .my_games
                    .get(&game_id)
                    .map(|g| g.has_opponent)
                    .unwrap_or(false);
                let has_opponent = black.is_some() && white.is_some();
                self.my_games.entry(game_id).and_modify(|g| {
                    g.stage = stage.clone();
                    g.our_stone = our_stone;
                    g.board = Some(state.clone());
                    g.has_opponent = has_opponent;
                });

                if is_our_turn_now {
                    info!(
                        "{} our turn in game {game_id} (stage={stage})",
                        self.bot_name()
                    );
                }

                if stage_before.as_deref() != Some(stage.as_str())
                    || (!had_opponent && has_opponent)
                {
                    self.handle_game_stage_hook(game_id).await;
                }
            }
            ServerMsg::UndoRequestSent { game_id } => {
                info!(
                    "{} undo request sent in game {game_id} (auto-accepting)",
                    self.bot_name()
                );
            }
            ServerMsg::UndoResponseNeeded { game_id, .. } => {
                info!("{} auto-accepting undo in game {game_id}", self.bot_name());
                send_json(&self.ws_tx, &ClientMsg::respond_to_undo(game_id, "accept"));
            }
            ServerMsg::UndoAccepted { game_id, .. } => {
                info!("{} undo accepted in game {game_id}", self.bot_name());
            }
            ServerMsg::UndoRejected { game_id } => {
                info!("{} undo rejected in game {game_id}", self.bot_name());
            }
            ServerMsg::Error {
                game_id, message, ..
            } => {
                let gid_str = game_id
                    .map(|g| g.to_string())
                    .unwrap_or_else(|| "none".to_string());
                info!(
                    "{} server error [game={gid_str}]: {message}",
                    self.bot_name()
                );
            }
            _ => {
                // Chat, presence, presentation messages — ignored
            }
        }
    }

    async fn handle_game_stage_hook(&mut self, game_id: i64) {
        if let Some(ag) = self.my_games.get(&game_id) {
            match ag.stage.as_str() {
                "challenge" if ag.has_opponent => {
                    info!(
                        "{} auto-accepting challenge game={game_id}",
                        self.bot_name()
                    );
                    send_json(&self.ws_tx, &ClientMsg::accept_challenge(game_id));
                }
                "unstarted" if ag.has_opponent => {
                    info!(
                        "{} auto-accepting pregame settings game={game_id}",
                        self.bot_name()
                    );
                    send_json(&self.ws_tx, &ClientMsg::accept_pregame_settings(game_id));
                }
                "territory_review" => {
                    info!(
                        "{} auto-approving territory game={game_id}",
                        self.bot_name()
                    );
                    send_json(&self.ws_tx, &ClientMsg::approve_territory(game_id));
                }
                "completed" | "resigned" | "aborted" | "declined" | "timeout" => {
                    self.my_games.remove(&game_id);
                }
                _ => {}
            }
        }
    }

    fn join_game(&mut self, game_id: i64) {
        send_json(&self.ws_tx, &ClientMsg::join_game(game_id));
        self.lobby_games.retain(|&id| id != game_id);
    }

    async fn tick(&mut self) {
        // Clean up finished games
        self.my_games.retain(|_id, ag| {
            !matches!(
                ag.stage.as_str(),
                "completed" | "resigned" | "aborted" | "declined" | "timeout"
            )
        });

        // Remove stale lobby entries (games we're already in)
        self.lobby_games
            .retain(|id| !self.my_games.contains_key(id));

        // Determine if we're idle (no active games) or in-game
        let has_active_games = self.my_games.values().any(|g| {
            matches!(
                g.stage.as_str(),
                "black_to_play" | "white_to_play" | "territory_review"
            ) || (matches!(g.stage.as_str(), "challenge" | "unstarted") && g.has_opponent)
        });

        // Always try to join from lobby
        if !self.lobby_games.is_empty() {
            self.join_random_game().await;
        }

        // Create if we have no games at all
        if self.my_games.is_empty() {
            self.create_random_game().await;
        }

        if !has_active_games {
            // Nothing to do: no playable games and no reason to create
        } else {
            // Pick a random active game where we can do something
            let playable: Vec<i64> = self
                .my_games
                .iter()
                .filter(|(_, g)| {
                    matches!(g.stage.as_str(), "black_to_play" | "white_to_play")
                        && g.board.is_some()
                        && g.our_stone.is_some_and(|s| match s {
                            Stone::Black => g.stage == "black_to_play",
                            Stone::White => g.stage == "white_to_play",
                        })
                })
                .map(|(id, _)| *id)
                .collect();

            if !playable.is_empty() {
                let game_id = playable[self.rng.random_range(0..playable.len())];
                let action = pick_game_action(&mut self.rng, &self.config.probabilities);
                match action {
                    GameAction::Play => {
                        self.play_random_move(game_id);
                    }
                    GameAction::Pass => {
                        info!("{} passing in game {game_id}", self.bot_name());
                        send_json(&self.ws_tx, &ClientMsg::pass(game_id));
                    }
                    GameAction::Resign => {
                        info!("{} resigning game {game_id}", self.bot_name());
                        send_json(&self.ws_tx, &ClientMsg::resign(game_id));
                    }
                    GameAction::RequestUndo => {
                        info!("{} requesting undo in game {game_id}", self.bot_name());
                        send_json(&self.ws_tx, &ClientMsg::respond_to_undo(game_id, "accept"));
                    }
                    GameAction::Chat => {
                        let msg = random_chat_message(&mut self.rng);
                        let json = serde_json::json!({
                            "action": "chat",
                            "game_id": game_id,
                            "message": msg,
                        });
                        if let Ok(s) = serde_json::to_string(&json) {
                            let _ = self.ws_tx.send(s);
                        }
                    }
                }
            }
        }
    }

    async fn create_random_game(&mut self) {
        let body = random_create_game_body(&mut self.rng, &self.config.game_settings);
        let cols = body["cols"].as_i64().unwrap_or(19);
        let rows = body["rows"].as_i64().unwrap_or(19);
        info!("{} creating game {cols}x{rows}", self.bot_name());
        match self
            .http
            .post::<serde_json::Value>("/api/games", &body)
            .await
        {
            Ok(resp) => {
                if let Some(id) = resp.get("id").and_then(|v| v.as_i64()) {
                    info!("{} created game {id}", self.bot_name());
                    self.my_games.entry(id).or_insert(ActiveGame {
                        stage: "unstarted".into(),
                        our_stone: Some(Stone::Black),
                        board: None,
                        has_opponent: false,
                    });
                    self.join_game(id);
                }
            }
            Err(e) => {
                info!("{} failed to create game: {e}", self.bot_name());
            }
        }
    }

    async fn join_random_game(&mut self) {
        if self.lobby_games.is_empty() {
            return;
        }
        let idx = self.rng.random_range(0..self.lobby_games.len());
        let game_id = self.lobby_games[idx];
        info!("{} joining game {game_id}", self.bot_name());

        let path = format!("/api/games/{game_id}/join");
        match self
            .http
            .post::<serde_json::Value>(&path, &serde_json::json!({}))
            .await
        {
            Ok(_) => {
                self.join_game(game_id);
            }
            Err(e) => {
                info!("{} join HTTP failed game={game_id}: {e}", self.bot_name());
                self.lobby_games.retain(|&id| id != game_id);
            }
        }
    }

    fn play_random_move(&mut self, game_id: i64) {
        if let Some(ag) = self.my_games.get(&game_id)
            && let Some(board) = &ag.board
        {
            if let Some((col, row)) = pick_random_move(&mut self.rng, board) {
                info!(
                    "{} playing ({col},{row}) in game {game_id}",
                    self.bot_name()
                );
                send_json(&self.ws_tx, &ClientMsg::play(game_id, col, row));
            } else {
                info!(
                    "{} no empty spots, passing in game {game_id}",
                    self.bot_name()
                );
                send_json(&self.ws_tx, &ClientMsg::pass(game_id));
            }
        }
    }
}

fn is_joinable(game: &LiveGameItem) -> bool {
    if game.result.is_some() {
        return false;
    }
    matches!(
        game.stage.as_str(),
        "challenge" | "unstarted" | "black_to_play" | "white_to_play" | "territory_review"
    ) && (game.black.is_none() || game.white.is_none())
}

fn guess_stone(game: &LiveGameItem, user_id: i64) -> Option<Stone> {
    if game.black.as_ref().is_some_and(|u| u.id == user_id) {
        Some(Stone::Black)
    } else if game.white.as_ref().is_some_and(|u| u.id == user_id) {
        Some(Stone::White)
    } else {
        None
    }
}
