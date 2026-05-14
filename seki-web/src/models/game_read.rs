use std::collections::HashMap;

use sqlx::{QueryBuilder, Sqlite};

pub struct GameRead;

impl GameRead {
    /// Insert or update the last-seen move count for a user+game pair.
    pub async fn upsert(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        game_id: i64,
        move_count: i32,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO game_reads (user_id, game_id, last_seen_move_count)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, game_id)
             DO UPDATE SET last_seen_move_count = MAX(game_reads.last_seen_move_count, excluded.last_seen_move_count)",
        )
        .bind(user_id)
        .bind(game_id)
        .bind(move_count)
        .execute(executor)
        .await?;
        Ok(())
    }

    /// Batch fetch last-seen move counts for a user across multiple games.
    pub async fn find_by_user_and_games(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        game_ids: &[i64],
    ) -> Result<HashMap<i64, i32>, sqlx::Error> {
        if game_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let mut query = QueryBuilder::<Sqlite>::new(
            "SELECT game_id, last_seen_move_count FROM game_reads WHERE user_id = ",
        );
        query.push_bind(user_id).push(" AND game_id IN (");
        let mut separated = query.separated(", ");
        for game_id in game_ids {
            separated.push_bind(game_id);
        }
        separated.push_unseparated(")");

        let rows: Vec<(i64, i32)> = query.build_query_as().fetch_all(executor).await?;
        Ok(rows.into_iter().collect())
    }
}
