use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use go_engine::Stone;

use crate::db::DbPool;
use crate::models::player::Player;

pub const BLACK_SYMBOL: &str = "●";
pub const WHITE_SYMBOL: &str = "○";
pub const SYSTEM_SYMBOL: &str = "⚑";

#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type, Serialize, Deserialize)]
#[sqlx(type_name = "time_control_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum TimeControlType {
    #[default]
    None,
    Fischer,
    Byoyomi,
    Correspondence,
}

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)]
pub struct Game {
    pub id: i64,
    pub creator_id: Option<i64>,
    pub black_id: Option<i64>,
    pub white_id: Option<i64>,
    pub undo_rejected: bool,
    pub invite_token: Option<String>,
    pub cols: i32,
    pub rows: i32,
    pub komi: f64,
    pub handicap: i32,
    pub is_private: bool,
    pub is_handicap: bool,
    pub allow_undo: bool,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub result: Option<String>,
    pub cached_engine_state: Option<String>,
    pub stage: String,
    pub time_control: TimeControlType,
    pub main_time_secs: Option<i32>,
    pub increment_secs: Option<i32>,
    pub byoyomi_time_secs: Option<i32>,
    pub byoyomi_periods: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Game {
    pub async fn list_public(pool: &DbPool) -> Result<Vec<Game>, sqlx::Error> {
        sqlx::query_as::<_, Game>(
            "SELECT * FROM games WHERE is_private = false \
             AND result IS DISTINCT FROM 'Aborted' \
             AND (result IS NULL OR updated_at >= now() - interval '5 minutes') \
             ORDER BY updated_at DESC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn list_public_with_players(
        pool: &DbPool,
        exclude_id: Option<i64>,
    ) -> Result<Vec<GameWithPlayers>, sqlx::Error> {
        let mut games = Self::list_public(pool).await?;

        if let Some(id) = exclude_id {
            games.retain(|g| g.black_id != Some(id) && g.white_id != Some(id))
        }

        Self::batch_with_players(pool, games).await
    }

    pub async fn list_for_player(
        pool: &DbPool,
        player_id: i64,
    ) -> Result<Vec<GameWithPlayers>, sqlx::Error> {
        let games = sqlx::query_as::<_, Game>(
            "SELECT * FROM games WHERE (black_id = $1 OR white_id = $1) \
             AND result IS DISTINCT FROM 'Aborted' \
             AND (result IS NULL OR updated_at >= now() - interval '5 minutes') \
             ORDER BY updated_at DESC",
        )
        .bind(player_id)
        .fetch_all(pool)
        .await?;

        Self::batch_with_players(pool, games).await
    }

    /// Load players for a batch of games in a single query (avoids N+1).
    async fn batch_with_players(
        pool: &DbPool,
        games: Vec<Game>,
    ) -> Result<Vec<GameWithPlayers>, sqlx::Error> {
        // Collect all unique player IDs
        let mut player_ids: Vec<i64> = games
            .iter()
            .flat_map(|g| [g.creator_id, g.black_id, g.white_id].into_iter().flatten())
            .collect();
        player_ids.sort_unstable();
        player_ids.dedup();

        // Batch fetch all players
        let players_map: HashMap<i64, Player> = if player_ids.is_empty() {
            HashMap::new()
        } else {
            Player::find_by_ids(pool, &player_ids)
                .await?
                .into_iter()
                .map(|p| (p.id, p))
                .collect()
        };

        Ok(games
            .into_iter()
            .map(|game| {
                let creator = game.creator_id.and_then(|id| players_map.get(&id).cloned());
                let black = game.black_id.and_then(|id| players_map.get(&id).cloned());
                let white = game.white_id.and_then(|id| players_map.get(&id).cloned());
                GameWithPlayers {
                    game,
                    creator,
                    black,
                    white,
                }
            })
            .collect())
    }

    pub async fn delete(pool: &DbPool, game_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM games WHERE id = $1")
            .bind(game_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn find_by_id(pool: &DbPool, id: i64) -> Result<Game, sqlx::Error> {
        sqlx::query_as::<_, Game>("SELECT * FROM games WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
    }

    pub async fn find_with_players(pool: &DbPool, id: i64) -> Result<GameWithPlayers, sqlx::Error> {
        let game = Self::find_by_id(pool, id).await?;
        let creator = if let Some(cid) = game.creator_id {
            Player::find_by_id(pool, cid).await.ok()
        } else {
            None
        };
        let black = if let Some(bid) = game.black_id {
            Player::find_by_id(pool, bid).await.ok()
        } else {
            None
        };
        let white = if let Some(wid) = game.white_id {
            Player::find_by_id(pool, wid).await.ok()
        } else {
            None
        };
        Ok(GameWithPlayers {
            game,
            creator,
            black,
            white,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        pool: &DbPool,
        creator_id: i64,
        black_id: Option<i64>,
        white_id: Option<i64>,
        cols: i32,
        rows: i32,
        komi: f64,
        handicap: i32,
        is_private: bool,
        is_handicap: bool,
        allow_undo: bool,
        invite_token: &str,
        time_control: TimeControlType,
        main_time_secs: Option<i32>,
        increment_secs: Option<i32>,
        byoyomi_time_secs: Option<i32>,
        byoyomi_periods: Option<i32>,
    ) -> Result<Game, sqlx::Error> {
        sqlx::query_as::<_, Game>(
            "INSERT INTO games (creator_id, black_id, white_id, cols, rows, komi, handicap, is_private, is_handicap, allow_undo, invite_token, time_control, main_time_secs, increment_secs, byoyomi_time_secs, byoyomi_periods)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING *",
        )
        .bind(creator_id)
        .bind(black_id)
        .bind(white_id)
        .bind(cols)
        .bind(rows)
        .bind(komi)
        .bind(handicap)
        .bind(is_private)
        .bind(is_handicap)
        .bind(allow_undo)
        .bind(invite_token)
        .bind(time_control)
        .bind(main_time_secs)
        .bind(increment_secs)
        .bind(byoyomi_time_secs)
        .bind(byoyomi_periods)
        .fetch_one(pool)
        .await
    }

    pub async fn set_black(pool: &DbPool, game_id: i64, player_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET black_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(player_id)
            .bind(game_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn set_white(pool: &DbPool, game_id: i64, player_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET white_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(player_id)
            .bind(game_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn set_undo_rejected(
        pool: &DbPool,
        game_id: i64,
        rejected: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET undo_rejected = $1, updated_at = NOW() WHERE id = $2")
            .bind(rejected)
            .bind(game_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn set_started(pool: &DbPool, game_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE games SET started_at = NOW(), updated_at = NOW() WHERE id = $1 AND started_at IS NULL",
        )
        .bind(game_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn set_stage(pool: &DbPool, game_id: i64, stage: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET stage = $1, updated_at = NOW() WHERE id = $2")
            .bind(stage)
            .bind(game_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn set_ended(pool: &DbPool, game_id: i64, result: &str) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE games SET ended_at = NOW(), result = $1, stage = 'done', updated_at = NOW() WHERE id = $2",
        )
        .bind(result)
        .bind(game_id)
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_cached_engine_state(
        pool: &DbPool,
        game_id: i64,
        state: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET cached_engine_state = $1, updated_at = NOW() WHERE id = $2")
            .bind(state)
            .bind(game_id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

/// Game with eagerly loaded player associations.
#[derive(Debug, Clone)]
pub struct GameWithPlayers {
    pub game: Game,
    #[allow(dead_code)] // Loaded for completeness; not yet read
    pub creator: Option<Player>,
    pub black: Option<Player>,
    pub white: Option<Player>,
}

impl GameWithPlayers {
    pub fn has_player(&self, player_id: i64) -> bool {
        self.black.as_ref().is_some_and(|p| p.id == player_id)
            || self.white.as_ref().is_some_and(|p| p.id == player_id)
    }

    pub fn player_stone(&self, player_id: i64) -> i32 {
        if self.black.as_ref().is_some_and(|p| p.id == player_id) {
            1
        } else if self.white.as_ref().is_some_and(|p| p.id == player_id) {
            -1
        } else {
            0
        }
    }

    pub fn is_open(&self) -> bool {
        self.black.is_none() || self.white.is_none()
    }

    /// The player whose turn it is.
    pub fn turn_player(&self, current_turn: Stone) -> Option<&Player> {
        match current_turn {
            Stone::Black => self.black.as_ref(),
            Stone::White => self.white.as_ref(),
        }
    }

    /// The player who is *not* the current turn (i.e. they just played).
    pub fn out_of_turn_player(&self, current_turn: Stone) -> Option<&Player> {
        self.turn_player(current_turn.opp())
    }

    pub fn opponent_of(&self, player_id: i64) -> Option<&Player> {
        if self.black.as_ref().is_some_and(|p| p.id == player_id) {
            self.white.as_ref()
        } else if self.white.as_ref().is_some_and(|p| p.id == player_id) {
            self.black.as_ref()
        } else {
            None
        }
    }
}
