use go_engine::Turn;
use serde::{Deserialize, Serialize};

use crate::game::{
    ClockSnapshot, GameSettings, InGameClock, Negotiations, RatingSnapshots, SettledTerritoryData,
    TerritoryState,
};
use crate::user::UserData;

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

/// Messages sent from client to server via WebSocket.
#[derive(Debug, Serialize, Deserialize)]
pub struct ClientMsg {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<i64>,
    #[serde(flatten)]
    pub payload: ClientPayload,
}

/// Variant payload for client messages, keyed by `action`.
#[derive(Debug, Serialize, Deserialize)]
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
    /// Pregame settings negotiation payload.
    PregameSettings {
        handicap: i32,
        komi: f64,
        color: String,
    },
    /// Chat message payload.
    Chat {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        client_message_id: Option<String>,
    },
    /// Territory chain toggle.
    ToggleChain {
        col: u8,
        row: u8,
    },
    /// Presentation snapshot update.
    PresentationState {
        #[serde(default)]
        snapshot: String,
    },
    /// Give presentation control to another user.
    GiveControl {
        target_user_id: i64,
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

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

/// Messages received from server via WebSocket, discriminated by `kind` field.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ServerMsg {
    /// Full lobby initialisation on connect.
    Init {
        player_id: i64,
        player_games: Vec<LiveGameItem>,
        public_games: Vec<LiveGameItem>,
    },
    /// A new game appeared in the lobby.
    GameCreated { game: LiveGameItem },
    /// An existing lobby game changed (stage, players, clock, board_state).
    GameUpdated { game: LiveGameItem },
    /// A game was removed from the lobby (aborted/deleted).
    GameRemoved { game_id: i64 },
    /// Full game state sent on room join (includes `can_start_presentation`).
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
        clock: Option<InGameClock>,
        #[serde(default)]
        can_start_presentation: Option<bool>,
    },
    /// Incremental game state update (subset of `StateSync`, no presentation info).
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
        clock: Option<InGameClock>,
    },
    /// Generic error message for a specific game.
    Error {
        game_id: Option<i64>,
        message: String,
        #[serde(default)]
        client_message_id: Option<String>,
    },
    /// Notification-only: chat message was posted (content delivered separately via REST).
    Chat { game_id: i64 },
    /// Undo was accepted and applied.
    UndoAccepted {
        game_id: i64,
        state: go_engine::GameState,
        current_turn_stone: i32,
        moves: Vec<Turn>,
        undo_rejected: bool,
        #[serde(default)]
        clock: Option<InGameClock>,
    },
    /// Undo was rejected by the opponent.
    UndoRejected { game_id: i64 },
    /// Confirmation that an undo request was sent to the opponent.
    UndoRequestSent { game_id: i64 },
    /// The recipient needs to respond to an undo request.
    UndoResponseNeeded {
        game_id: i64,
        #[serde(default)]
        requesting_player: Option<String>,
    },
    /// A player lost their WebSocket connection (grace period started).
    PlayerDisconnected {
        game_id: i64,
        user_id: i64,
        timestamp: String,
        #[serde(default)]
        grace_period_ms: Option<i64>,
    },
    /// A previously-disconnected player reconnected.
    PlayerReconnected { game_id: i64, user_id: i64 },
    /// The disconnect grace period expired — opponent may claim victory.
    PlayerGone { game_id: i64, user_id: i64 },
    /// A user's online status changed (presence subscription).
    PresenceChanged { user_id: i64, online: bool },
    /// Bulk presence state (initial sync on subscribe).
    PresenceState {
        users: std::collections::HashMap<String, bool>,
    },
    // -- Presentation (post-game collaborative analysis) --
    /// A presentation was started.
    PresentationStarted {
        game_id: i64,
        presenter_id: i64,
        originator_id: i64,
        #[serde(default)]
        snapshot: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        control_request: Option<ControlRequestData>,
    },
    /// The presentation ended.
    PresentationEnded { game_id: i64 },
    /// A presentation snapshot was updated (broadcast to everyone except the presenter).
    PresentationUpdate { game_id: i64, snapshot: String },
    /// Presentation control changed (give_control, take_control, or fallback).
    ControlChanged { game_id: i64, presenter_id: i64 },
    /// Someone requested presentation control.
    ControlRequested {
        game_id: i64,
        user_id: i64,
        display_name: String,
    },
    /// A control request was cancelled or rejected.
    ControlRequestCancelled { game_id: i64 },
}

// ---------------------------------------------------------------------------
// Lobby / game list types
// ---------------------------------------------------------------------------

/// A game entry shown in the lobby (init, game_created, game_updated).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ranked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_handicap: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_komi: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub derived_color_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unread: Option<bool>,
    /// Serialized board state for quick lobby preview (only in `init`/`game_created`/`game_updated`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board_state: Option<serde_json::Value>,
    /// Lobby-level clock snapshot (only in `init`/`game_created`/`game_updated`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clock: Option<ClockSnapshot>,
}

/// Game settings with optional rating-at-start snapshots (ranked games).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct GameSettingsWithSnapshots {
    #[serde(flatten)]
    pub settings: GameSettings,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating_snapshots: Option<RatingSnapshots>,
}

/// Data for a pending presentation control request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlRequestData {
    pub user_id: i64,
    pub display_name: String,
}
