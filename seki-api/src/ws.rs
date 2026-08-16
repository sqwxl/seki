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
/// Discriminated by the `action` field; each variant carries its own payload
/// so the action and payload can never disagree.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ClientMsg {
    // -- Transport / connection-level --
    /// Client is closing the connection deliberately.
    Bye,
    /// Client heartbeat.
    Ping,
    /// Subscribe to a game room.
    JoinGame {
        game_id: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        access_token: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        invite_token: Option<String>,
    },
    /// Leave a game room without closing the connection.
    LeaveGame {
        game_id: i64,
    },
    /// Subscribe to presence updates for the given user ids.
    SubscribePresence {
        user_ids: Vec<i64>,
    },

    // -- Game actions --
    Play {
        game_id: i64,
        col: i32,
        row: i32,
        #[serde(skip_serializing_if = "Option::is_none")]
        client_move_time_ms: Option<i64>,
    },
    Pass {
        game_id: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        client_move_time_ms: Option<i64>,
    },
    Resign {
        game_id: i64,
    },
    AcceptChallenge {
        game_id: i64,
    },
    DeclineChallenge {
        game_id: i64,
    },
    Abort {
        game_id: i64,
    },
    Chat {
        game_id: i64,
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        client_message_id: Option<String>,
    },
    RequestUndo {
        game_id: i64,
    },
    RespondToUndo {
        game_id: i64,
        response: String,
    },
    ToggleChain {
        game_id: i64,
        col: u8,
        row: u8,
    },
    ApproveTerritory {
        game_id: i64,
    },
    /// Pregame settings negotiation update.
    UpdatePregameSettings {
        game_id: i64,
        handicap: i32,
        komi: f64,
        color: String,
    },
    AcceptPregameSettings {
        game_id: i64,
    },
    RejectPregameSettings {
        game_id: i64,
    },
    ClaimVictory {
        game_id: i64,
    },
    TimeoutFlag {
        game_id: i64,
    },
    TerritoryTimeoutFlag {
        game_id: i64,
    },
    StartPresentation {
        game_id: i64,
    },
    EndPresentation {
        game_id: i64,
    },
    /// Presentation snapshot update.
    PresentationState {
        game_id: i64,
        #[serde(default)]
        snapshot: String,
    },
    GiveControl {
        game_id: i64,
        target_user_id: i64,
    },
    TakeControl {
        game_id: i64,
    },
    RequestControl {
        game_id: i64,
    },
    CancelControlRequest {
        game_id: i64,
    },
    RejectControlRequest {
        game_id: i64,
    },
}

impl ClientMsg {
    /// The game id carried by game-scoped variants (None for transport messages).
    pub fn game_id(&self) -> Option<i64> {
        match self {
            ClientMsg::Bye | ClientMsg::Ping | ClientMsg::SubscribePresence { .. } => None,
            ClientMsg::JoinGame { game_id, .. }
            | ClientMsg::LeaveGame { game_id, .. }
            | ClientMsg::Play { game_id, .. }
            | ClientMsg::Pass { game_id, .. }
            | ClientMsg::Resign { game_id }
            | ClientMsg::AcceptChallenge { game_id }
            | ClientMsg::DeclineChallenge { game_id }
            | ClientMsg::Abort { game_id }
            | ClientMsg::Chat { game_id, .. }
            | ClientMsg::RequestUndo { game_id }
            | ClientMsg::RespondToUndo { game_id, .. }
            | ClientMsg::ToggleChain { game_id, .. }
            | ClientMsg::ApproveTerritory { game_id }
            | ClientMsg::UpdatePregameSettings { game_id, .. }
            | ClientMsg::AcceptPregameSettings { game_id }
            | ClientMsg::RejectPregameSettings { game_id }
            | ClientMsg::ClaimVictory { game_id }
            | ClientMsg::TimeoutFlag { game_id }
            | ClientMsg::TerritoryTimeoutFlag { game_id }
            | ClientMsg::StartPresentation { game_id }
            | ClientMsg::EndPresentation { game_id }
            | ClientMsg::PresentationState { game_id, .. }
            | ClientMsg::GiveControl { game_id, .. }
            | ClientMsg::TakeControl { game_id }
            | ClientMsg::RequestControl { game_id }
            | ClientMsg::CancelControlRequest { game_id }
            | ClientMsg::RejectControlRequest { game_id } => Some(*game_id),
        }
    }

    // -- Constructor helpers (used by bot crates) --

    pub fn join_game(game_id: i64) -> Self {
        ClientMsg::JoinGame {
            game_id,
            access_token: None,
            invite_token: None,
        }
    }

    pub fn play(game_id: i64, col: i32, row: i32) -> Self {
        ClientMsg::Play {
            game_id,
            col,
            row,
            client_move_time_ms: None,
        }
    }

    pub fn pass(game_id: i64) -> Self {
        ClientMsg::Pass {
            game_id,
            client_move_time_ms: None,
        }
    }

    pub fn respond_to_undo(game_id: i64, response: &str) -> Self {
        ClientMsg::RespondToUndo {
            game_id,
            response: response.to_string(),
        }
    }
}

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

/// Messages received from server via WebSocket, discriminated by `kind` field.
// Wire message enum deserialized once per message; the large `State` payload
// is not cloned in hot paths, so boxing it would be premature.
#[allow(clippy::large_enum_variant)]
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
    /// Full or incremental game state. `hydrate_only` is true on room
    /// join/reconnect (no side effects) and false for live updates.
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        can_start_presentation: Option<bool>,
        hydrate_only: bool,
    },
    /// Generic error message for a specific game.
    Error {
        game_id: Option<i64>,
        message: String,
        #[serde(default)]
        client_message_id: Option<String>,
    },
    /// A chat message was posted (broadcast to the room with full content).
    Chat {
        game_id: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<i64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        user_data: Option<UserData>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        client_message_id: Option<String>,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        move_number: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sent_at: Option<String>,
    },
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
    /// Undo was rejected by the opponent (carries the same body as `UndoAccepted`).
    UndoRejected {
        game_id: i64,
        state: go_engine::GameState,
        current_turn_stone: i32,
        moves: Vec<Turn>,
        undo_rejected: bool,
        #[serde(default)]
        clock: Option<InGameClock>,
    },
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
    /// Server heartbeat response.
    Pong,
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
