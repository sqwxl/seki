//! Seed the database with test users at various rating levels.
//!
//! Usage:
//!   DATABASE_URL="sqlite://seki.db" cargo run --bin seed

use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHasher};
use seki_web::db;

#[tokio::main]
async fn main() {
    let db_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://seki.db".to_string());
    let pool = db::create_pool(&db_url)
        .await
        .expect("Failed to create pool");
    db::run_migrations(&pool)
        .await
        .expect("Failed to run migrations");

    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(b"test", &salt)
        .unwrap()
        .to_string();

    let users: &[(&str, f64, f64)] = &[
        ("seed-30k", 100.0, 80.0),
        ("seed-20k", 900.0, 70.0),
        ("seed-10k", 1400.0, 60.0),
        ("seed-5k", 1700.0, 55.0),
        ("seed-1k", 2100.0, 50.0),
        ("seed-3d", 2500.0, 45.0),
        ("seed-6d", 2800.0, 40.0),
        ("seed-9d", 3100.0, 35.0),
    ];

    for (username, rating, deviation) in users {
        // Upsert user
        let user_id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, password_hash) VALUES ($1, $2) \
             ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash \
             RETURNING id",
        )
        .bind(username)
        .bind(&password_hash)
        .fetch_one(&pool)
        .await
        .expect("Failed to upsert user");

        // Upsert rating profile
        sqlx::query(
            "INSERT INTO rating_profiles (user_id, rating, deviation, volatility, rated_games) \
             VALUES ($1, $2, $3, 0.06, 20) \
             ON CONFLICT (user_id) DO UPDATE SET rating = $2, deviation = $3, volatility = 0.06, rated_games = 20",
        )
        .bind(user_id)
        .bind(*rating)
        .bind(*deviation)
        .execute(&pool)
        .await
        .expect("Failed to upsert rating profile");

        println!("Seeded {} (id={}, rating={:.0})", username, user_id, rating);
    }

    println!("Done. {} users seeded.", users.len());
}
