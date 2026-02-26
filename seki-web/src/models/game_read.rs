use std::collections::HashMap;

pub struct GameRead;

impl GameRead {
    /// Insert or update the last-seen move count for a user+game pair.
    pub async fn upsert(
        executor: impl sqlx::PgExecutor<'_>,
        user_id: i64,
        game_id: i64,
        move_count: i32,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO game_reads (user_id, game_id, last_seen_move_count)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, game_id)
             DO UPDATE SET last_seen_move_count = GREATEST(game_reads.last_seen_move_count, $3)",
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
        executor: impl sqlx::PgExecutor<'_>,
        user_id: i64,
        game_ids: &[i64],
    ) -> Result<HashMap<i64, i32>, sqlx::Error> {
        if game_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let rows: Vec<(i64, i32)> = sqlx::query_as(
            "SELECT game_id, last_seen_move_count FROM game_reads
             WHERE user_id = $1 AND game_id = ANY($2)",
        )
        .bind(user_id)
        .bind(game_ids)
        .fetch_all(executor)
        .await?;
        Ok(rows.into_iter().collect())
    }
}
