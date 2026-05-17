use chrono::{DateTime, Utc};
use tokio::task::JoinHandle;

use crate::ws::registry::GameRegistry;

pub(super) struct DisconnectState {
    pub(super) since: DateTime<Utc>,
    pub(super) bye: bool,
    pub(super) gone_timer: Option<JoinHandle<()>>,
    pub(super) is_gone: bool,
}

// Manual Debug impl because JoinHandle doesn't impl Debug in all contexts
impl std::fmt::Debug for DisconnectState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DisconnectState")
            .field("since", &self.since)
            .field("bye", &self.bye)
            .field("is_gone", &self.is_gone)
            .finish()
    }
}

// Disconnect tracking methods on GameRegistry
impl GameRegistry {
    /// Check if a player is marked as disconnected in a game room.
    pub async fn is_player_disconnected(&self, game_id: i64, player_id: i64) -> bool {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .is_some_and(|room| room.disconnected_players.contains_key(&player_id))
    }

    /// Mark a player as disconnected in a game room.
    pub async fn mark_disconnected(
        &self,
        game_id: i64,
        player_id: i64,
        now: DateTime<Utc>,
        bye: bool,
    ) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.disconnected_players.insert(
                player_id,
                DisconnectState {
                    since: now,
                    bye,
                    gone_timer: None,
                    is_gone: false,
                },
            );
        }
    }

    /// Clear a player's disconnected status and abort any gone timer.
    pub async fn mark_reconnected(&self, game_id: i64, player_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id)
            && let Some(state) = room.disconnected_players.remove(&player_id)
            && let Some(handle) = state.gone_timer
        {
            handle.abort();
        }
    }

    /// Get the timestamp when a player was marked disconnected.
    pub async fn disconnect_time(&self, game_id: i64, player_id: i64) -> Option<DateTime<Utc>> {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .and_then(|room| room.disconnected_players.get(&player_id))
            .map(|s| s.since)
    }

    /// Get the `bye` flag for a disconnected player.
    pub async fn disconnect_bye(&self, game_id: i64, player_id: i64) -> bool {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .and_then(|room| room.disconnected_players.get(&player_id))
            .is_some_and(|s| s.bye)
    }

    /// Store the gone timer handle for a disconnected player.
    pub async fn set_gone_timer(&self, game_id: i64, player_id: i64, handle: JoinHandle<()>) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id)
            && let Some(state) = room.disconnected_players.get_mut(&player_id)
        {
            state.gone_timer = Some(handle);
        }
    }

    /// Mark a disconnected player as "gone" (grace period expired).
    pub async fn mark_player_gone(&self, game_id: i64, player_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id)
            && let Some(state) = room.disconnected_players.get_mut(&player_id)
        {
            state.is_gone = true;
        }
    }

    /// Check if a disconnected player is marked as "gone".
    pub async fn is_player_gone(&self, game_id: i64, player_id: i64) -> bool {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .and_then(|room| room.disconnected_players.get(&player_id))
            .is_some_and(|s| s.is_gone)
    }

    /// Find all game room IDs where a user is marked as disconnected.
    pub async fn games_with_disconnected_player(&self, user_id: i64) -> Vec<i64> {
        let rooms = self.rooms.read().await;
        rooms
            .iter()
            .filter(|(_, room)| room.disconnected_players.contains_key(&user_id))
            .map(|(game_id, _)| *game_id)
            .collect()
    }
}
