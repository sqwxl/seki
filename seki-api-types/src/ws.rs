use go_engine::Turn;
use serde::{Deserialize, Serialize};

use crate::game::{
    ClockState, GameSettings, Negotiations, RatingSnapshots, SettledTerritoryData, TerritoryState,
};
use crate::user::UserData;

/// Messages sent from client to server via WebSocket.
#[derive(Debug, Serialize)]
pub struct ClientMsg {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<i64>,
    #[serde(flatten)]
    pub payload: ClientPayload,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum ClientPayload {
    JoinGame {
        #[serde(skip_serializing_if = "Option::is_none")]
        access_token: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        invite_token: Option<String>,
    },
    Play {
        col: i32,
        row: i32,
        #[serde(skip_serializing_if = "Option::is_none")]
        client_move_time_ms: Option<i64>,
    },
    Pass {
        #[serde(skip_serializing_if = "Option::is_none")]
        client_move_time_ms: Option<i64>,
    },
    RespondToUndo {
        response: String,
    },
    Empty,
}

impl ClientMsg {
    pub fn join_game(game_id: i64) -> Self {
        ClientMsg {
            action: "join_game".into(),
            game_id: Some(game_id),
            payload: ClientPayload::JoinGame {
                access_token: None,
                invite_token: None,
            },
        }
    }

    pub fn play(game_id: i64, col: i32, row: i32) -> Self {
        ClientMsg {
            action: "play".into(),
            game_id: Some(game_id),
            payload: ClientPayload::Play {
                col,
                row,
                client_move_time_ms: None,
            },
        }
    }

    pub fn pass(game_id: i64) -> Self {
        ClientMsg {
            action: "pass".into(),
            game_id: Some(game_id),
            payload: ClientPayload::Pass {
                client_move_time_ms: None,
            },
        }
    }

    pub fn resign(game_id: i64) -> Self {
        ClientMsg {
            action: "resign".into(),
            game_id: Some(game_id),
            payload: ClientPayload::Empty,
        }
    }

    pub fn accept_challenge(game_id: i64) -> Self {
        ClientMsg {
            action: "accept_challenge".into(),
            game_id: Some(game_id),
            payload: ClientPayload::Empty,
        }
    }

    pub fn respond_to_undo(game_id: i64, response: &str) -> Self {
        ClientMsg {
            action: "respond_to_undo".into(),
            game_id: Some(game_id),
            payload: ClientPayload::RespondToUndo {
                response: response.to_string(),
            },
        }
    }

    pub fn accept_pregame_settings(game_id: i64) -> Self {
        ClientMsg {
            action: "accept_pregame_settings".into(),
            game_id: Some(game_id),
            payload: ClientPayload::Empty,
        }
    }

    pub fn approve_territory(game_id: i64) -> Self {
        ClientMsg {
            action: "approve_territory".into(),
            game_id: Some(game_id),
            payload: ClientPayload::Empty,
        }
    }
}

/// Messages received from server via WebSocket, discriminated by `kind` field.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ServerMsg {
    Init {
        player_id: i64,
        player_games: Vec<LiveGameItem>,
        public_games: Vec<LiveGameItem>,
    },
    GameCreated {
        game: LiveGameItem,
    },
    GameUpdated {
        game: LiveGameItem,
    },
    GameRemoved {
        game_id: i64,
    },
    StateSync {
        game_id: i64,
        stage: String,
        state: go_engine::GameState,
        moves: Vec<Turn>,
        current_turn_stone: i32,
        creator: Option<UserData>,
        opponent: Option<UserData>,
        black: Option<UserData>,
        white: Option<UserData>,
        komi: f64,
        result: Option<String>,
        undo_rejected: bool,
        allow_undo: bool,
        nigiri: bool,
        settings: GameSettingsWithSnapshots,
        #[serde(default)]
        negotiations: Option<Negotiations>,
        #[serde(default)]
        territory: Option<TerritoryState>,
        #[serde(default)]
        settled_territory: Option<SettledTerritoryData>,
        #[serde(default)]
        clock: Option<ClockState>,
        #[serde(default)]
        can_start_presentation: Option<bool>,
    },
    State {
        game_id: i64,
        stage: String,
        state: go_engine::GameState,
        moves: Vec<Turn>,
        current_turn_stone: i32,
        creator: Option<UserData>,
        opponent: Option<UserData>,
        black: Option<UserData>,
        white: Option<UserData>,
        komi: f64,
        result: Option<String>,
        undo_rejected: bool,
        allow_undo: bool,
        nigiri: bool,
        settings: GameSettingsWithSnapshots,
        #[serde(default)]
        negotiations: Option<Negotiations>,
        #[serde(default)]
        territory: Option<TerritoryState>,
        #[serde(default)]
        settled_territory: Option<SettledTerritoryData>,
        #[serde(default)]
        clock: Option<ClockState>,
    },
    Error {
        game_id: Option<i64>,
        message: String,
        #[serde(default)]
        client_message_id: Option<String>,
    },
    Chat {
        game_id: i64,
    },
    UndoAccepted {
        game_id: i64,
        state: go_engine::GameState,
        current_turn_stone: i32,
        moves: Vec<Turn>,
        undo_rejected: bool,
        #[serde(default)]
        clock: Option<ClockState>,
    },
    UndoRejected {
        game_id: i64,
    },
    UndoRequestSent {
        game_id: i64,
    },
    UndoResponseNeeded {
        game_id: i64,
        #[serde(default)]
        requesting_player: Option<String>,
    },
    PlayerDisconnected {
        game_id: i64,
        user_id: i64,
        timestamp: String,
        #[serde(default)]
        grace_period_ms: Option<i64>,
    },
    PlayerReconnected {
        game_id: i64,
        user_id: i64,
    },
    PlayerGone {
        game_id: i64,
        user_id: i64,
    },
    PresenceChanged {
        user_id: i64,
        online: bool,
    },
    PresenceState {
        users: std::collections::HashMap<String, bool>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveGameItem {
    pub id: i64,
    pub creator_id: Option<i64>,
    pub creator: Option<UserData>,
    pub opponent: Option<UserData>,
    pub stage: String,
    pub result: Option<String>,
    pub black: Option<UserData>,
    pub white: Option<UserData>,
    pub settings: GameSettings,
    pub move_count: Option<usize>,
    #[serde(default)]
    pub ranked: bool,
    pub derived_handicap: Option<i32>,
    pub derived_komi: Option<f64>,
    pub derived_color_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unread: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSettingsWithSnapshots {
    #[serde(flatten)]
    pub settings: GameSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating_snapshots: Option<RatingSnapshots>,
}
