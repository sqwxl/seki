use chrono::{DateTime, Utc};
use sqlx::FromRow;

use crate::db::DbPool;
use crate::models::player::Player;

#[derive(Debug, Clone, FromRow)]
#[allow(dead_code)] // Fields populated by SELECT * via sqlx
pub struct Game {
    pub id: i64,
    pub creator_id: Option<i64>,
    pub black_id: Option<i64>,
    pub white_id: Option<i64>,
    pub undo_requesting_player_id: Option<i64>,
    pub invite_token: Option<String>,
    pub cols: i32,
    pub rows: i32,
    pub komi: f64,
    pub handicap: i32,
    pub is_private: bool,
    pub is_handicap: bool,
    pub started_at: Option<DateTime<Utc>>,
    pub ended_at: Option<DateTime<Utc>>,
    pub result: Option<String>,
    pub cached_engine_state: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Game with eagerly loaded player associations.
#[derive(Debug, Clone)]
pub struct GameWithPlayers {
    pub game: Game,
    #[allow(dead_code)] // Loaded for completeness; not yet read
    pub creator: Option<Player>,
    pub black: Option<Player>,
    pub white: Option<Player>,
    pub undo_requesting_player: Option<Player>,
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

    pub fn has_pending_undo_request(&self) -> bool {
        self.game.undo_requesting_player_id.is_some()
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

impl Game {
    pub async fn list_public(pool: &DbPool) -> Result<Vec<Game>, sqlx::Error> {
        sqlx::query_as::<_, Game>(
            "SELECT * FROM games WHERE is_private = false ORDER BY created_at DESC",
        )
        .fetch_all(pool)
        .await
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

    pub async fn find_with_players(
        pool: &DbPool,
        id: i64,
    ) -> Result<GameWithPlayers, sqlx::Error> {
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
        let undo_requesting_player = if let Some(uid) = game.undo_requesting_player_id {
            Player::find_by_id(pool, uid).await.ok()
        } else {
            None
        };
        Ok(GameWithPlayers {
            game,
            creator,
            black,
            white,
            undo_requesting_player,
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
        invite_token: &str,
    ) -> Result<Game, sqlx::Error> {
        sqlx::query_as::<_, Game>(
            "INSERT INTO games (creator_id, black_id, white_id, cols, rows, komi, handicap, is_private, is_handicap, invite_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        .bind(invite_token)
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

    pub async fn set_undo_requesting_player(
        pool: &DbPool,
        game_id: i64,
        player_id: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET undo_requesting_player_id = $1, updated_at = NOW() WHERE id = $2")
            .bind(player_id)
            .bind(game_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn set_ended(
        pool: &DbPool,
        game_id: i64,
        result: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE games SET ended_at = NOW(), result = $1, updated_at = NOW() WHERE id = $2")
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
