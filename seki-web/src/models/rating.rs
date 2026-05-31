//! Persistence helpers for player rating state.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use sqlx::FromRow;
use sqlx::QueryBuilder;
use sqlx::Sqlite;

use crate::db::DbPool;
use crate::models::user::User;

#[derive(Debug, Clone, FromRow)]
pub struct RatingProfile {
    pub user_id: i64,
    pub participating: bool,
    pub rating: f64,
    pub deviation: f64,
    pub volatility: f64,
    pub rated_games: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
pub struct RatingAdjustment {
    pub id: i64,
    pub user_id: i64,
    pub game_id: i64,
    pub opponent_id: i64,
    pub result: String,
    pub rating_before: f64,
    pub rating_after: f64,
    pub deviation_before: f64,
    pub deviation_after: f64,
    pub volatility_before: f64,
    pub volatility_after: f64,
    pub rating_delta: f64,
    pub opponent_rating_before: f64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct NewRatingAdjustment<'a> {
    pub user_id: i64,
    pub game_id: i64,
    pub opponent_id: i64,
    pub result: &'a str,
    pub rating_before: f64,
    pub rating_after: f64,
    pub deviation_before: f64,
    pub deviation_after: f64,
    pub volatility_before: f64,
    pub volatility_after: f64,
    pub opponent_rating_before: f64,
}

#[derive(Debug, Clone)]
pub struct PlayerDirectoryFilters {
    pub exclude_uncertain: bool,
    pub include_unranked: bool,
    pub online_ids: Option<std::collections::HashSet<i64>>,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone)]
pub struct PlayerDirectoryRow {
    pub user: User,
    pub profile: Option<RatingProfile>,
    pub wins: i64,
    pub losses: i64,
    pub rating_trend: Vec<f64>,
    pub last_active_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow)]
struct PlayerDirectoryBaseRow {
    user_id: i64,
    wins: i64,
    losses: i64,
    last_active_at: DateTime<Utc>,
}

const PLAYER_TREND_GAMES: i64 = 10;

impl RatingProfile {
    pub async fn find(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>("SELECT * FROM rating_profiles WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(executor)
            .await
    }

    pub async fn find_batch(
        pool: &DbPool,
        user_ids: &[i64],
    ) -> Result<HashMap<i64, Self>, sqlx::Error> {
        if user_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let ids_json = serde_json::to_string(user_ids).unwrap_or_default();
        let rows: Vec<Self> = sqlx::query_as(
            "SELECT * FROM rating_profiles WHERE user_id IN (SELECT value FROM json_each($1))",
        )
        .bind(&ids_json)
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(|p| (p.user_id, p)).collect())
    }

    pub async fn get_or_create(pool: &DbPool, user_id: i64) -> Result<Self, sqlx::Error> {
        sqlx::query(
            "INSERT INTO rating_profiles (user_id) VALUES ($1) \
             ON CONFLICT (user_id) DO NOTHING",
        )
        .bind(user_id)
        .execute(pool)
        .await?;

        sqlx::query_as::<_, Self>("SELECT * FROM rating_profiles WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
    }

    pub async fn set_participating(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        participating: bool,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO rating_profiles (user_id, participating) VALUES ($1, $2) \
             ON CONFLICT (user_id) DO UPDATE SET \
             participating = excluded.participating, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(user_id)
        .bind(participating)
        .execute(executor)
        .await?;
        Ok(())
    }

    pub async fn update_rating(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
        rating: f64,
        deviation: f64,
        volatility: f64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE rating_profiles SET \
             rating = $2, deviation = $3, volatility = $4, \
             rated_games = rated_games + 1, updated_at = CURRENT_TIMESTAMP \
             WHERE user_id = $1",
        )
        .bind(user_id)
        .bind(rating)
        .bind(deviation)
        .bind(volatility)
        .execute(executor)
        .await?;
        Ok(())
    }
}

impl RatingAdjustment {
    pub async fn insert(
        executor: impl sqlx::SqliteExecutor<'_>,
        adjustment: &NewRatingAdjustment<'_>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            "INSERT OR IGNORE INTO rating_adjustments \
             (user_id, game_id, opponent_id, result, rating_before, rating_after, \
              deviation_before, deviation_after, volatility_before, volatility_after, \
              rating_delta, opponent_rating_before) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        )
        .bind(adjustment.user_id)
        .bind(adjustment.game_id)
        .bind(adjustment.opponent_id)
        .bind(adjustment.result)
        .bind(adjustment.rating_before)
        .bind(adjustment.rating_after)
        .bind(adjustment.deviation_before)
        .bind(adjustment.deviation_after)
        .bind(adjustment.volatility_before)
        .bind(adjustment.volatility_after)
        .bind(adjustment.rating_after - adjustment.rating_before)
        .bind(adjustment.opponent_rating_before)
        .execute(executor)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn list_for_user(
        executor: impl sqlx::SqliteExecutor<'_>,
        user_id: i64,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Self>(
            "SELECT * FROM rating_adjustments \
             WHERE user_id = $1 \
             ORDER BY created_at ASC, id ASC",
        )
        .bind(user_id)
        .fetch_all(executor)
        .await
    }
}

pub async fn list_player_directory(
    pool: &DbPool,
    filters: &PlayerDirectoryFilters,
) -> Result<Vec<PlayerDirectoryRow>, sqlx::Error> {
    let mut query = QueryBuilder::<Sqlite>::new(
        "WITH base AS ( \
         SELECT u.id AS user_id, \
                CASE WHEN rp.user_id IS NULL THEN 3 \
                     WHEN rp.participating = 0 THEN 2 \
                     WHEN rp.rated_games = 0 THEN 1 \
                     ELSE 0 END AS sort_bucket, \
                COALESCE(MAX(g.updated_at), u.updated_at) AS last_active_at, \
                CASE WHEN rp.user_id IS NOT NULL AND rp.participating = 1 AND rp.rated_games > 0 \
                     THEN SUM(CASE WHEN g.ranked = 1 AND g.result LIKE 'B+%' AND g.black_id = u.id THEN 1 \
                                   WHEN g.ranked = 1 AND g.result LIKE 'W+%' AND g.white_id = u.id THEN 1 \
                                   ELSE 0 END) \
                     ELSE SUM(CASE WHEN g.result LIKE 'B+%' AND g.black_id = u.id THEN 1 \
                                   WHEN g.result LIKE 'W+%' AND g.white_id = u.id THEN 1 \
                                   ELSE 0 END) END AS wins, \
                CASE WHEN rp.user_id IS NOT NULL AND rp.participating = 1 AND rp.rated_games > 0 \
                     THEN SUM(CASE WHEN g.ranked = 1 AND g.result LIKE 'B+%' AND g.white_id = u.id THEN 1 \
                                   WHEN g.ranked = 1 AND g.result LIKE 'W+%' AND g.black_id = u.id THEN 1 \
                                   ELSE 0 END) \
                     ELSE SUM(CASE WHEN g.result LIKE 'B+%' AND g.white_id = u.id THEN 1 \
                                   WHEN g.result LIKE 'W+%' AND g.black_id = u.id THEN 1 \
                                   ELSE 0 END) END AS losses, \
                rp.rating AS rating \
         FROM users u \
         LEFT JOIN rating_profiles rp ON rp.user_id = u.id \
         LEFT JOIN games g ON g.black_id = u.id OR g.white_id = u.id \
         WHERE u.password_hash IS NOT NULL",
    );

    if !filters.include_unranked {
        query.push(" AND rp.user_id IS NOT NULL AND rp.participating = 1 AND rp.rated_games > 0");
    }
    if filters.exclude_uncertain {
        query.push(" AND rp.user_id IS NOT NULL AND rp.deviation <= ");
        query.push_bind(crate::services::rating::PROVISIONAL_DEVIATION_THRESHOLD);
    }
    if let Some(ids) = &filters.online_ids {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        query.push(" AND u.id IN (");
        let mut separated = query.separated(", ");
        for id in ids {
            separated.push_bind(id);
        }
        separated.push_unseparated(")");
    }

    query.push(
        " GROUP BY u.id, rp.user_id, rp.participating, rp.rated_games, rp.rating \
          ) \
          SELECT user_id, COALESCE(wins, 0) AS wins, COALESCE(losses, 0) AS losses, last_active_at \
          FROM base \
          ORDER BY sort_bucket ASC, rating DESC, last_active_at DESC, user_id ASC \
          LIMIT ",
    );
    query.push_bind(filters.limit);
    query.push(" OFFSET ");
    query.push_bind(filters.offset);

    let base_rows = query
        .build_query_as::<PlayerDirectoryBaseRow>()
        .fetch_all(pool)
        .await?;
    let user_ids: Vec<i64> = base_rows.iter().map(|row| row.user_id).collect();
    let users = User::find_by_ids(pool, &user_ids).await?;
    let profiles = RatingProfile::find_batch(pool, &user_ids).await?;
    let trends = recent_rating_trends(pool, &user_ids, PLAYER_TREND_GAMES).await?;

    let user_map: HashMap<i64, User> = users.into_iter().map(|user| (user.id, user)).collect();
    Ok(base_rows
        .into_iter()
        .filter_map(|row| {
            let user = user_map.get(&row.user_id)?.clone();
            Some(PlayerDirectoryRow {
                user,
                profile: profiles.get(&row.user_id).cloned(),
                wins: row.wins,
                losses: row.losses,
                rating_trend: trends.get(&row.user_id).cloned().unwrap_or_default(),
                last_active_at: row.last_active_at,
            })
        })
        .collect())
}

async fn recent_rating_trends(
    pool: &DbPool,
    user_ids: &[i64],
    limit_per_user: i64,
) -> Result<HashMap<i64, Vec<f64>>, sqlx::Error> {
    if user_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let ids_json = serde_json::to_string(user_ids).unwrap_or_default();
    let rows: Vec<(i64, f64)> = sqlx::query_as(
        "SELECT user_id, rating_after FROM ( \
         SELECT user_id, rating_after, \
                ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn \
         FROM rating_adjustments \
         WHERE user_id IN (SELECT value FROM json_each($1)) \
         ) \
         WHERE rn <= $2 \
         ORDER BY user_id ASC, rn DESC",
    )
    .bind(&ids_json)
    .bind(limit_per_user)
    .fetch_all(pool)
    .await?;

    let mut trends: HashMap<i64, Vec<f64>> = HashMap::new();
    for (user_id, rating) in rows {
        trends.entry(user_id).or_default().push(rating);
    }
    Ok(trends)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> DbPool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("test db");
        crate::db::run_migrations(&pool).await.expect("migrations");
        pool
    }

    async fn insert_user(pool: &DbPool, username: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO users (username, password_hash) VALUES ($1, 'hash') RETURNING id",
        )
        .bind(username)
        .fetch_one(pool)
        .await
        .expect("insert user")
    }

    async fn insert_profile(pool: &DbPool, user_id: i64, rating: f64, deviation: f64) {
        sqlx::query(
            "INSERT INTO rating_profiles (user_id, rating, deviation, rated_games) VALUES ($1, $2, $3, 5)",
        )
        .bind(user_id)
        .bind(rating)
        .bind(deviation)
        .execute(pool)
        .await
        .expect("insert profile");
    }

    #[tokio::test]
    async fn player_directory_defaults_to_certain_ranked_players() {
        let pool = test_pool().await;
        let strong = insert_user(&pool, "strong").await;
        let weak = insert_user(&pool, "weak").await;
        let uncertain = insert_user(&pool, "uncertain").await;
        let unranked = insert_user(&pool, "unranked").await;
        insert_profile(&pool, strong, 1800.0, 80.0).await;
        insert_profile(&pool, weak, 1500.0, 80.0).await;
        insert_profile(&pool, uncertain, 1900.0, 160.0).await;
        sqlx::query(
            "INSERT INTO rating_profiles (user_id, rating, deviation, rated_games) VALUES ($1, 1400.0, 350.0, 0)",
        )
        .bind(unranked)
        .execute(&pool)
        .await
        .expect("insert unranked profile");

        let rows = list_player_directory(
            &pool,
            &PlayerDirectoryFilters {
                exclude_uncertain: true,
                include_unranked: false,
                online_ids: None,
                limit: 50,
                offset: 0,
            },
        )
        .await
        .expect("players");

        let names: Vec<_> = rows.iter().map(|row| row.user.username.as_str()).collect();
        assert_eq!(names, vec!["strong", "weak"]);
    }

    #[tokio::test]
    async fn player_directory_can_include_uncertain_and_unranked() {
        let pool = test_pool().await;
        let uncertain = insert_user(&pool, "uncertain").await;
        let unranked = insert_user(&pool, "unranked").await;
        insert_profile(&pool, uncertain, 1900.0, 160.0).await;
        sqlx::query(
            "INSERT INTO rating_profiles (user_id, rating, deviation, rated_games) VALUES ($1, 1400.0, 350.0, 0)",
        )
        .bind(unranked)
        .execute(&pool)
        .await
        .expect("insert unranked profile");

        let rows = list_player_directory(
            &pool,
            &PlayerDirectoryFilters {
                exclude_uncertain: false,
                include_unranked: true,
                online_ids: None,
                limit: 50,
                offset: 0,
            },
        )
        .await
        .expect("players");

        let names: Vec<_> = rows.iter().map(|row| row.user.username.as_str()).collect();
        assert_eq!(names, vec!["uncertain", "unranked"]);
    }
}
