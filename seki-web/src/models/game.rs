use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

use go_engine::Stone;

use crate::db::DbPool;
use crate::models::user::User;

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
    pub clock_black_ms: Option<i64>,
    pub clock_white_ms: Option<i64>,
    pub clock_black_periods: Option<i32>,
    pub clock_white_periods: Option<i32>,
    pub clock_active_stone: Option<i32>,
    pub clock_last_move_at: Option<DateTime<Utc>>,
    pub clock_expires_at: Option<DateTime<Utc>>,
    pub territory_review_expires_at: Option<DateTime<Utc>>,
    pub nigiri: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Game {
    pub async fn list_public(
        executor: impl sqlx::PgExecutor<'_>,
    ) -> Result<Vec<Game>, sqlx::Error> {
        sqlx::query_as::<_, Game>(
            "SELECT * FROM games WHERE is_private = false \
             AND result IS DISTINCT FROM 'Aborted' \
             AND result IS DISTINCT FROM 'Declined' \
             AND (result IS NULL OR updated_at >= now() - interval '5 minutes') \
             ORDER BY updated_at DESC",
        )
        .fetch_all(executor)
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
        user_id: i64,
    ) -> Result<Vec<GameWithPlayers>, sqlx::Error> {
        let games = sqlx::query_as::<_, Game>(
            "SELECT * FROM games WHERE (black_id = $1 OR white_id = $1) \
             AND result IS DISTINCT FROM 'Aborted' \
             AND result IS DISTINCT FROM 'Declined' \
             AND (result IS NULL OR updated_at >= now() - interval '5 minutes') \
             ORDER BY updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Self::batch_with_players(pool, games).await
    }

    pub async fn list_all_for_player(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Vec<GameWithPlayers>, sqlx::Error> {
        let games = sqlx::query_as::<_, Game>(
            "SELECT * FROM games WHERE (black_id = $1 OR white_id = $1) \
             ORDER BY updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Self::batch_with_players(pool, games).await
    }

    /// Load users for a batch of games in a single query (avoids N+1).
    async fn batch_with_players(
        pool: &DbPool,
        games: Vec<Game>,
    ) -> Result<Vec<GameWithPlayers>, sqlx::Error> {
        // Collect all unique user IDs
        let mut user_ids: Vec<i64> = games
            .iter()
            .flat_map(|g| [g.creator_id, g.black_id, g.white_id].into_iter().flatten())
            .collect();
        user_ids.sort_unstable();
        user_ids.dedup();

        // Batch fetch all users
        let users_map: HashMap<i64, User> = if user_ids.is_empty() {
            HashMap::new()
        } else {
            User::find_by_ids(pool, &user_ids)
                .await?
                .into_iter()
                .map(|p| (p.id, p))
                .collect()
        };

        Ok(games
            .into_iter()
            .map(|game| {
                let creator = game.creator_id.and_then(|id| users_map.get(&id).cloned());
                let black = game.black_id.and_then(|id| users_map.get(&id).cloned());
                let white = game.white_id.and_then(|id| users_map.get(&id).cloned());
                GameWithPlayers {
                    game,
                    creator,
                    black,
                    white,
                }
            })
            .collect())
    }

    /// Find active timed non-correspondence game IDs where the user is a player.
    /// "Active" = result IS NULL, stage is a play stage or territory_review.
    pub async fn active_timed_game_ids(
        pool: &DbPool,
        user_id: i64,
    ) -> Result<Vec<i64>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT id FROM games \
             WHERE (black_id = $1 OR white_id = $1) \
             AND result IS NULL \
             AND stage IN ('black_to_play', 'white_to_play', 'territory_review') \
             AND time_control IN ('fischer', 'byoyomi')",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await
    }

    pub async fn delete(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM games WHERE id = $1")
            .bind(game_id)
            .execute(executor)
            .await?;
        Ok(())
    }

    pub async fn find_by_id(
        executor: impl sqlx::PgExecutor<'_>,
        id: i64,
    ) -> Result<Game, sqlx::Error> {
        sqlx::query_as::<_, Game>("SELECT * FROM games WHERE id = $1")
            .bind(id)
            .fetch_one(executor)
            .await
    }

    pub async fn find_with_players(pool: &DbPool, id: i64) -> Result<GameWithPlayers, sqlx::Error> {
        let game = Self::find_by_id(pool, id).await?;

        let mut user_ids: Vec<i64> = [game.creator_id, game.black_id, game.white_id]
            .into_iter()
            .flatten()
            .collect();
        user_ids.sort_unstable();
        user_ids.dedup();

        let users_map: HashMap<i64, User> = if user_ids.is_empty() {
            HashMap::new()
        } else {
            User::find_by_ids(pool, &user_ids)
                .await?
                .into_iter()
                .map(|u| (u.id, u))
                .collect()
        };

        Ok(GameWithPlayers {
            creator: game.creator_id.and_then(|id| users_map.get(&id).cloned()),
            black: game.black_id.and_then(|id| users_map.get(&id).cloned()),
            white: game.white_id.and_then(|id| users_map.get(&id).cloned()),
            game,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        executor: impl sqlx::PgExecutor<'_>,
        creator_id: i64,
        black_id: Option<i64>,
        white_id: Option<i64>,
        cols: i32,
        rows: i32,
        komi: f64,
        handicap: i32,
        is_private: bool,
        allow_undo: bool,
        invite_token: &str,
        time_control: TimeControlType,
        main_time_secs: Option<i32>,
        increment_secs: Option<i32>,
        byoyomi_time_secs: Option<i32>,
        byoyomi_periods: Option<i32>,
        clock_black_ms: Option<i64>,
        clock_white_ms: Option<i64>,
        clock_black_periods: Option<i32>,
        clock_white_periods: Option<i32>,
        nigiri: bool,
    ) -> Result<Game, sqlx::Error> {
        sqlx::query_as::<_, Game>(
            "INSERT INTO games (creator_id, black_id, white_id, cols, rows, komi, handicap, \
             is_private, allow_undo, invite_token, time_control, main_time_secs, \
             increment_secs, byoyomi_time_secs, byoyomi_periods, \
             clock_black_ms, clock_white_ms, clock_black_periods, clock_white_periods, nigiri)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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
        .bind(allow_undo)
        .bind(invite_token)
        .bind(time_control)
        .bind(main_time_secs)
        .bind(increment_secs)
        .bind(byoyomi_time_secs)
        .bind(byoyomi_periods)
        .bind(clock_black_ms)
        .bind(clock_white_ms)
        .bind(clock_black_periods)
        .bind(clock_white_periods)
        .bind(nigiri)
        .fetch_one(executor)
        .await
    }

    pub async fn set_black(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        user_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET black_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(user_id)
            .bind(game_id)
            .execute(executor)
            .await?;
        Ok(())
    }

    pub async fn set_white(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        user_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET white_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(user_id)
            .bind(game_id)
            .execute(executor)
            .await?;
        Ok(())
    }

    pub async fn swap_players(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE games SET black_id = white_id, white_id = black_id, updated_at = NOW() WHERE id = $1",
        )
        .bind(game_id)
        .execute(executor)
        .await?;
        Ok(())
    }

    pub async fn set_undo_rejected(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        rejected: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET undo_rejected = $1, updated_at = NOW() WHERE id = $2")
            .bind(rejected)
            .bind(game_id)
            .execute(executor)
            .await?;
        Ok(())
    }

    pub async fn set_started(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE games SET started_at = NOW(), updated_at = NOW() WHERE id = $1 AND started_at IS NULL",
        )
        .bind(game_id)
        .execute(executor)
        .await?;
        Ok(())
    }

    pub async fn set_stage(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        stage: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET stage = $1, updated_at = NOW() WHERE id = $2")
            .bind(stage)
            .bind(game_id)
            .execute(executor)
            .await?;
        Ok(())
    }

    pub async fn set_ended(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        result: &str,
        stage: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE games SET ended_at = NOW(), result = $1, stage = $2, updated_at = NOW() WHERE id = $3",
        )
        .bind(result)
        .bind(stage)
        .bind(game_id)
        .execute(executor)
        .await?;
        Ok(())
    }

    pub async fn update_cached_engine_state(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        state: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET cached_engine_state = $1, updated_at = NOW() WHERE id = $2")
            .bind(state)
            .bind(game_id)
            .execute(executor)
            .await?;
        Ok(())
    }

    pub async fn update_clock(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        update: &crate::services::clock::ClockUpdate,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE games SET \
             clock_black_ms = $2, clock_white_ms = $3, \
             clock_black_periods = $4, clock_white_periods = $5, \
             clock_active_stone = $6, clock_last_move_at = $7, \
             clock_expires_at = $8, updated_at = NOW() \
             WHERE id = $1",
        )
        .bind(game_id)
        .bind(update.black_ms)
        .bind(update.white_ms)
        .bind(update.black_periods)
        .bind(update.white_periods)
        .bind(update.active_stone)
        .bind(update.last_move_at)
        .bind(update.expires_at)
        .execute(executor)
        .await?;
        Ok(())
    }

    /// Load settled territory data (dead stones + scores) for a finished game.
    pub async fn load_settled_territory(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
    ) -> Result<Option<(Option<serde_json::Value>, i32, i32, i32, i32)>, sqlx::Error> {
        sqlx::query_as::<_, (Option<serde_json::Value>, i32, i32, i32, i32)>(
            "SELECT dead_stones, black_territory, black_captures, white_territory, white_captures \
             FROM territory_reviews \
             WHERE game_id = $1 AND settled = TRUE \
             AND black_territory IS NOT NULL \
             LIMIT 1",
        )
        .bind(game_id)
        .fetch_optional(executor)
        .await
    }

    pub async fn find_expired_clocks(
        executor: impl sqlx::PgExecutor<'_>,
    ) -> Result<Vec<Game>, sqlx::Error> {
        sqlx::query_as::<_, Game>(
            "SELECT * FROM games \
             WHERE result IS NULL \
             AND clock_expires_at IS NOT NULL \
             AND clock_expires_at < NOW()",
        )
        .fetch_all(executor)
        .await
    }

    pub async fn set_territory_review_deadline(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
        expires_at: DateTime<Utc>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE games SET territory_review_expires_at = $1, updated_at = NOW() WHERE id = $2",
        )
        .bind(expires_at)
        .bind(game_id)
        .execute(executor)
        .await?;
        Ok(())
    }

    pub async fn clear_territory_review_deadline(
        executor: impl sqlx::PgExecutor<'_>,
        game_id: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE games SET territory_review_expires_at = NULL, updated_at = NOW() WHERE id = $1",
        )
        .bind(game_id)
        .execute(executor)
        .await?;
        Ok(())
    }

    pub async fn find_expired_territory_reviews(
        executor: impl sqlx::PgExecutor<'_>,
    ) -> Result<Vec<Game>, sqlx::Error> {
        sqlx::query_as::<_, Game>(
            "SELECT * FROM games \
             WHERE result IS NULL \
             AND territory_review_expires_at IS NOT NULL \
             AND territory_review_expires_at < NOW()",
        )
        .fetch_all(executor)
        .await
    }
}

/// Game with eagerly loaded user associations.
#[derive(Debug, Clone)]
pub struct GameWithPlayers {
    pub game: Game,
    #[allow(dead_code)] // Loaded for completeness; not yet read
    pub creator: Option<User>,
    pub black: Option<User>,
    pub white: Option<User>,
}

impl GameWithPlayers {
    pub fn player_by_id(&self, user_id: i64) -> Option<&User> {
        self.black
            .as_ref()
            .filter(|p| p.id == user_id)
            .or_else(|| self.white.as_ref().filter(|p| p.id == user_id))
    }

    pub fn has_player(&self, user_id: i64) -> bool {
        self.black.as_ref().is_some_and(|p| p.id == user_id)
            || self.white.as_ref().is_some_and(|p| p.id == user_id)
    }

    pub fn player_stone(&self, user_id: i64) -> i32 {
        if self.black.as_ref().is_some_and(|p| p.id == user_id) {
            1
        } else if self.white.as_ref().is_some_and(|p| p.id == user_id) {
            -1
        } else {
            0
        }
    }

    pub fn is_open(&self) -> bool {
        self.black.is_none() || self.white.is_none()
    }

    /// The user whose turn it is.
    pub fn turn_player(&self, current_turn: Stone) -> Option<&User> {
        match current_turn {
            Stone::Black => self.black.as_ref(),
            Stone::White => self.white.as_ref(),
        }
    }

    /// The user who is *not* the current turn (i.e. they just played).
    pub fn out_of_turn_player(&self, current_turn: Stone) -> Option<&User> {
        self.turn_player(current_turn.opp())
    }

    pub fn opponent_of(&self, user_id: i64) -> Option<&User> {
        if self.black.as_ref().is_some_and(|p| p.id == user_id) {
            self.white.as_ref()
        } else if self.white.as_ref().is_some_and(|p| p.id == user_id) {
            self.black.as_ref()
        } else {
            None
        }
    }
}
