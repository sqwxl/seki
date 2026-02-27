use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use go_engine::{Engine, Point};
use tokio::sync::{RwLock, mpsc};

use crate::db::DbPool;
use crate::models::game::Game;
use crate::services::clock::ClockState;
use crate::services::engine_builder;

pub type WsSender = mpsc::UnboundedSender<String>;

#[derive(Debug, Clone)]
pub struct TerritoryReviewState {
    pub dead_stones: HashSet<Point>,
    pub black_approved: bool,
    pub white_approved: bool,
}

#[derive(Debug, Clone)]
pub struct PresentationState {
    pub presenter_id: i64,
    pub originator_id: i64,
    pub cached_snapshot: String,
    pub control_request: Option<i64>,
}

#[derive(Debug, Default)]
struct GameRoom {
    /// Map of player_id -> list of ws senders (a user may have multiple tabs open).
    players: HashMap<i64, Vec<WsSender>>,
    /// In-memory engine, built on first access, then mutated
    engine: Option<Engine>,
    /// Transient: whether an undo request is pending (lost on disconnect, which is fine)
    undo_requested: bool,
    /// Territory review state, present only during territory review phase
    territory_review: Option<TerritoryReviewState>,
    /// In-memory clock state for timed games
    clock: Option<ClockState>,
    /// Players marked as disconnected (player_id -> disconnect time)
    disconnected_players: HashMap<i64, DateTime<Utc>>,
    /// Active presentation state (post-game collaborative analysis)
    presentation: Option<PresentationState>,
    /// Whether a presentation has ever completed on this game room
    has_had_presentation: bool,
}

#[derive(Debug, Clone)]
pub struct GameRegistry {
    rooms: Arc<RwLock<HashMap<i64, GameRoom>>>,
}

impl GameRegistry {
    pub fn new() -> Self {
        GameRegistry {
            rooms: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Add a user's sender to a game room.
    pub async fn join(&self, game_id: i64, player_id: i64, sender: WsSender) {
        let mut rooms = self.rooms.write().await;
        let room = rooms.entry(game_id).or_default();
        room.players.entry(player_id).or_default().push(sender);
    }

    /// Remove a user's sender from a game room.
    /// Returns `true` if the user was fully removed (no remaining senders).
    pub async fn leave(&self, game_id: i64, player_id: i64, sender: &WsSender) -> bool {
        let mut rooms = self.rooms.write().await;
        let mut player_removed = false;
        if let Some(room) = rooms.get_mut(&game_id) {
            if let Some(senders) = room.players.get_mut(&player_id) {
                senders.retain(|s| !s.same_channel(sender));
                if senders.is_empty() {
                    room.players.remove(&player_id);
                    player_removed = true;
                }
            }
            if room.players.is_empty() {
                rooms.remove(&game_id);
            }
        }
        player_removed
    }

    /// Get the IDs of users currently connected to a game room.
    pub async fn get_online_user_ids(&self, game_id: i64) -> Vec<i64> {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .map(|room| room.players.keys().copied().collect())
            .unwrap_or_default()
    }

    /// Broadcast a message to all users in a game room.
    pub async fn broadcast(&self, game_id: i64, message: &str) {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(&game_id) {
            for senders in room.players.values() {
                for sender in senders {
                    let _ = sender.send(message.to_string());
                }
            }
        }
    }

    /// Send a message to a specific user in a game room.
    pub async fn send_to_player(&self, game_id: i64, player_id: i64, message: &str) {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(&game_id)
            && let Some(senders) = room.players.get(&player_id)
        {
            for sender in senders {
                let _ = sender.send(message.to_string());
            }
        }
    }

    /// Get the cached engine or initialize it from the DB.
    ///
    /// On cache hit (read lock), returns a clone immediately.
    /// On cache miss, builds from DB (no lock held), then stores under write lock.
    pub async fn get_or_init_engine(
        &self,
        pool: &DbPool,
        game: &Game,
    ) -> Result<Engine, sqlx::Error> {
        // Fast path: read lock check
        {
            let rooms = self.rooms.read().await;
            if let Some(room) = rooms.get(&game.id)
                && let Some(ref engine) = room.engine
            {
                return Ok(engine.clone());
            }
        }

        // Cache miss: build from DB (no lock held)
        let engine = engine_builder::build_engine(pool, game).await?;

        // Store under write lock
        {
            let mut rooms = self.rooms.write().await;
            let room = rooms.entry(game.id).or_default();
            room.engine = Some(engine.clone());
        }

        Ok(engine)
    }

    /// Apply a mutation to the cached engine and return the updated clone.
    ///
    /// The closure receives `&mut Engine` and should return `Ok(())` on success.
    /// If the closure fails, the engine is not modified.
    pub async fn with_engine_mut<F>(
        &self,
        game_id: i64,
        f: F,
    ) -> Option<Result<Engine, go_engine::GoError>>
    where
        F: FnOnce(&mut Engine) -> Result<(), go_engine::GoError>,
    {
        let mut rooms = self.rooms.write().await;
        let room = rooms.get_mut(&game_id)?;
        let engine = room.engine.as_mut()?;
        match f(engine) {
            Ok(()) => Some(Ok(engine.clone())),
            Err(e) => Some(Err(e)),
        }
    }

    /// Replace the cached engine (used after undo rebuild from DB).
    pub async fn replace_engine(&self, game_id: i64, engine: Engine) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.engine = Some(engine);
        }
    }

    /// Get a clone of the cached engine (read-only).
    pub async fn get_engine(&self, game_id: i64) -> Option<Engine> {
        let rooms = self.rooms.read().await;
        rooms.get(&game_id).and_then(|room| room.engine.clone())
    }

    pub async fn is_undo_requested(&self, game_id: i64) -> bool {
        let rooms = self.rooms.read().await;
        rooms.get(&game_id).is_some_and(|room| room.undo_requested)
    }

    pub async fn set_undo_requested(&self, game_id: i64, requested: bool) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.undo_requested = requested;
        }
    }

    // -- Clock --

    pub async fn get_clock(&self, game_id: i64) -> Option<ClockState> {
        let rooms = self.rooms.read().await;
        rooms.get(&game_id).and_then(|room| room.clock.clone())
    }

    pub async fn update_clock(&self, game_id: i64, clock: ClockState) {
        let mut rooms = self.rooms.write().await;
        let room = rooms.entry(game_id).or_default();
        room.clock = Some(clock);
    }

    // -- Territory review --

    pub async fn init_territory_review(&self, game_id: i64, dead_stones: HashSet<Point>) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.territory_review = Some(TerritoryReviewState {
                dead_stones,
                black_approved: false,
                white_approved: false,
            });
        }
    }

    pub async fn get_territory_review(&self, game_id: i64) -> Option<TerritoryReviewState> {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .and_then(|room| room.territory_review.clone())
    }

    /// Toggle the chain at `point`, reset approvals, return updated dead stones.
    pub async fn toggle_dead_chain(
        &self,
        game_id: i64,
        point: Point,
        goban: &go_engine::Goban,
    ) -> Option<HashSet<Point>> {
        let mut rooms = self.rooms.write().await;
        let room = rooms.get_mut(&game_id)?;
        let tr = room.territory_review.as_mut()?;
        go_engine::territory::toggle_dead_chain(goban, &mut tr.dead_stones, point);
        tr.black_approved = false;
        tr.white_approved = false;
        Some(tr.dead_stones.clone())
    }

    pub async fn set_approved(&self, game_id: i64, stone: go_engine::Stone, approved: bool) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id)
            && let Some(tr) = room.territory_review.as_mut()
        {
            match stone {
                go_engine::Stone::Black => tr.black_approved = approved,
                go_engine::Stone::White => tr.white_approved = approved,
            }
        }
    }

    pub async fn clear_territory_review(&self, game_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.territory_review = None;
        }
    }

    // -- Disconnect tracking --

    /// Check if a player is marked as disconnected in a game room.
    pub async fn is_player_disconnected(&self, game_id: i64, player_id: i64) -> bool {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .is_some_and(|room| room.disconnected_players.contains_key(&player_id))
    }

    /// Mark a player as disconnected in a game room.
    pub async fn mark_disconnected(&self, game_id: i64, player_id: i64, now: DateTime<Utc>) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.disconnected_players.insert(player_id, now);
        }
    }

    /// Clear a player's disconnected status in a game room.
    pub async fn mark_reconnected(&self, game_id: i64, player_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.disconnected_players.remove(&player_id);
        }
    }

    /// Get the timestamp when a player was marked disconnected.
    pub async fn disconnect_time(&self, game_id: i64, player_id: i64) -> Option<DateTime<Utc>> {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .and_then(|room| room.disconnected_players.get(&player_id).copied())
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

    // -- Presentation --

    pub async fn get_presentation(&self, game_id: i64) -> Option<PresentationState> {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .and_then(|room| room.presentation.clone())
    }

    pub async fn has_had_presentation(&self, game_id: i64) -> bool {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .is_some_and(|room| room.has_had_presentation)
    }

    pub async fn start_presentation(&self, game_id: i64, presenter_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.presentation = Some(PresentationState {
                presenter_id,
                originator_id: presenter_id,
                cached_snapshot: String::new(),
                control_request: None,
            });
        }
    }

    pub async fn end_presentation(&self, game_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.presentation = None;
            room.has_had_presentation = true;
        }
    }

    pub async fn update_presentation_snapshot(&self, game_id: i64, snapshot: String) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            if let Some(p) = room.presentation.as_mut() {
                p.cached_snapshot = snapshot;
            }
        }
    }

    pub async fn set_presenter(&self, game_id: i64, presenter_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            if let Some(p) = room.presentation.as_mut() {
                p.presenter_id = presenter_id;
                p.control_request = None;
            }
        }
    }

    pub async fn set_control_request(&self, game_id: i64, user_id: Option<i64>) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            if let Some(p) = room.presentation.as_mut() {
                p.control_request = user_id;
            }
        }
    }

    pub async fn is_in_room(&self, game_id: i64, user_id: i64) -> bool {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .is_some_and(|room| room.players.contains_key(&user_id))
    }

    /// Broadcast a message to all users in a game room except one.
    pub async fn broadcast_except(&self, game_id: i64, except_id: i64, message: &str) {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(&game_id) {
            for (&player_id, senders) in &room.players {
                if player_id != except_id {
                    for sender in senders {
                        let _ = sender.send(message.to_string());
                    }
                }
            }
        }
    }
}
