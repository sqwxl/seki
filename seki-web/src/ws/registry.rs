use std::collections::HashMap;
use std::sync::Arc;

use go_engine::Engine;
use tokio::sync::{mpsc, RwLock};

use crate::db::DbPool;
use crate::models::game::Game;
use crate::services::engine_builder;

pub type WsSender = mpsc::UnboundedSender<String>;

#[derive(Debug, Default)]
struct GameRoom {
    /// Map of player_id -> list of ws senders (a player may have multiple tabs open).
    players: HashMap<i64, Vec<WsSender>>,
    /// In-memory engine, built on first access, then mutated
    engine: Option<Engine>,
    /// Transient: whether an undo request is pending (lost on disconnect, which is fine)
    undo_requested: bool,
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
    pub async fn leave(&self, game_id: i64, player_id: i64, sender: &WsSender) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            if let Some(senders) = room.players.get_mut(&player_id) {
                senders.retain(|s| !s.same_channel(sender));
                if senders.is_empty() {
                    room.players.remove(&player_id);
                }
            }
            if room.players.is_empty() {
                rooms.remove(&game_id);
            }
        }
    }

    /// Broadcast a message to all players in a game room.
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

    /// Send a message to a specific player in a game room.
    pub async fn send_to_player(&self, game_id: i64, player_id: i64, message: &str) {
        let rooms = self.rooms.read().await;
        if let Some(room) = rooms.get(&game_id) {
            if let Some(senders) = room.players.get(&player_id) {
                for sender in senders {
                    let _ = sender.send(message.to_string());
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
        rooms
            .get(&game_id)
            .is_some_and(|room| room.undo_requested)
    }

    pub async fn set_undo_requested(&self, game_id: i64, requested: bool) {
        let mut rooms = self.rooms.write().await;
        if let Some(room) = rooms.get_mut(&game_id) {
            room.undo_requested = requested;
        }
    }
}
