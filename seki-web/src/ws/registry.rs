use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use go_engine::{Engine, Point};
use tokio::sync::{RwLock, mpsc};
use tokio::task::AbortHandle;

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

#[derive(Debug, Default)]
struct GameRoom {
    /// Map of player_id -> list of ws senders (a player may have multiple tabs open).
    players: HashMap<i64, Vec<WsSender>>,
    /// In-memory engine, built on first access, then mutated
    engine: Option<Engine>,
    /// Transient: whether an undo request is pending (lost on disconnect, which is fine)
    undo_requested: bool,
    /// Territory review state, present only during territory review phase
    territory_review: Option<TerritoryReviewState>,
    /// In-memory clock state for timed games
    clock: Option<ClockState>,
    /// Handle for the pending timeout task (cancellable)
    timeout_handle: Option<AbortHandle>,
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

    /// Add a player's sender to a game room.
    pub async fn join(&self, game_id: i64, player_id: i64, sender: WsSender) {
        let mut rooms = self.rooms.write().await;
        let room = rooms.entry(game_id).or_default();
        room.players.entry(player_id).or_default().push(sender);
    }

    /// Remove a player's sender from a game room.
    /// Returns `true` if the player was fully removed (no remaining senders).
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

    /// Get the IDs of players currently connected to a game room.
    pub async fn get_online_player_ids(&self, game_id: i64) -> Vec<i64> {
        let rooms = self.rooms.read().await;
        rooms
            .get(&game_id)
            .map(|room| room.players.keys().copied().collect())
            .unwrap_or_default()
    }

    /// Broadcast a message to all players in a game room.
    /// Injects `game_id` into the JSON message.
    pub async fn broadcast(&self, game_id: i64, message: &str) {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(&game_id) {
            let wrapped = inject_game_id(game_id, message);
            for senders in room.players.values() {
                for sender in senders {
                    let _ = sender.send(wrapped.clone());
                }
            }
        }
    }

    /// Send a message to a specific player in a game room.
    /// Injects `game_id` into the JSON message.
    pub async fn send_to_player(&self, game_id: i64, player_id: i64, message: &str) {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(&game_id) {
            if let Some(senders) = room.players.get(&player_id) {
                let wrapped = inject_game_id(game_id, message);
                for sender in senders {
                    let _ = sender.send(wrapped.clone());
                }
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
            if let Some(room) = rooms.get(&game.id) {
                if let Some(ref engine) = room.engine {
                    return Ok(engine.clone());
                }
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

    pub async fn schedule_timeout(
        &self,
        game_id: i64,
        delay: std::time::Duration,
        app_state: crate::AppState,
    ) {
        let mut rooms = self.rooms.write().await;
        let room = rooms.entry(game_id).or_default();

        // Cancel any existing timeout
        if let Some(handle) = room.timeout_handle.take() {
            handle.abort();
        }

        let handle = tokio::spawn(timeout_task(delay, app_state, game_id));

        room.timeout_handle = Some(handle.abort_handle());
    }

    pub async fn cancel_timeout(&self, game_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            if let Some(handle) = room.timeout_handle.take() {
                handle.abort();
            }
        }
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
        if let Some(room) = rooms.get_mut(&game_id) {
            if let Some(tr) = room.territory_review.as_mut() {
                match stone {
                    go_engine::Stone::Black => tr.black_approved = approved,
                    go_engine::Stone::White => tr.white_approved = approved,
                }
            }
        }
    }

    pub async fn clear_territory_review(&self, game_id: i64) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.territory_review = None;
        }
    }
}

/// Inject `"game_id": N` into a JSON object string.
fn inject_game_id(game_id: i64, message: &str) -> String {
    if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(message) {
        if let Some(obj) = val.as_object_mut() {
            obj.insert("game_id".to_string(), serde_json::json!(game_id));
            return val.to_string();
        }
    }
    message.to_string()
}

fn timeout_task(
    delay: std::time::Duration,
    app_state: crate::AppState,
    game_id: i64,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    Box::pin(async move {
        tokio::time::sleep(delay).await;
        crate::services::game_actions::handle_timeout(&app_state, game_id).await;
    })
}
