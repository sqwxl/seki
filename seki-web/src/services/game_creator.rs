use rand::RngExt;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::player::Player;

pub struct CreateGameParams {
    pub cols: i32,
    pub rows: i32,
    pub komi: f64,
    pub handicap: i32,
    pub is_private: bool,
    pub is_handicap: bool,
    pub allow_undo: bool,
    pub color: String,
    pub invite_email: Option<String>,
}

pub async fn create_game(
    pool: &DbPool,
    creator: &Player,
    params: CreateGameParams,
) -> Result<Game, AppError> {
    let friend = if let Some(ref email) = params.invite_email {
        if !email.is_empty() {
            Some(Player::find_or_create_by_email(pool, email).await?)
        } else {
            None
        }
    } else {
        None
    };

    let friend_id = friend.as_ref().map(|f| f.id);

    let (black_id, white_id) = match params.color.as_str() {
        "black" => (Some(creator.id), friend_id),
        "white" => (friend_id, Some(creator.id)),
        _ => {
            // Random assignment
            if rand::rng().random_bool(0.5) {
                (Some(creator.id), friend_id)
            } else {
                (friend_id, Some(creator.id))
            }
        }
    };

    let invite_token = generate_invite_token();

    let game = Game::create(
        pool,
        creator.id,
        black_id,
        white_id,
        params.cols,
        params.rows,
        params.komi,
        params.handicap,
        params.is_private,
        params.is_handicap,
        params.allow_undo,
        &invite_token,
    )
    .await?;

    Ok(game)
}

fn generate_invite_token() -> String {
    let mut rng = rand::rng();
    (0..22)
        .map(|_| {
            let idx = rng.random_range(0..62);
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[idx] as char
        })
        .collect()
}
