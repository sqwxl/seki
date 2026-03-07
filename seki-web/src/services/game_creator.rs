use rand::RngExt;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::{Game, TimeControlType};
use crate::models::user::User;
use crate::services::clock::{ClockState, TimeControl};

pub struct CreateGameParams {
    pub cols: i32,
    pub rows: i32,
    pub komi: f64,
    pub handicap: i32,
    pub is_private: bool,
    pub allow_undo: bool,
    pub color: String,
    pub invite_email: Option<String>,
    pub invite_username: Option<String>,
    pub time_control: TimeControlType,
    pub main_time_secs: Option<i32>,
    pub increment_secs: Option<i32>,
    pub byoyomi_time_secs: Option<i32>,
    pub byoyomi_periods: Option<i32>,
}

pub async fn create_game(
    pool: &DbPool,
    creator: &User,
    params: CreateGameParams,
) -> Result<Game, AppError> {
    // Komi must be a half-integer (e.g. 0.5, 6.5, -3.5) to prevent draws
    if params.komi.fract().abs() != 0.5 {
        return Err(AppError::UnprocessableEntity(
            "Komi must be a half-integer (e.g. 0.5, 6.5, -3.5)".to_string(),
        ));
    }

    // Board size validation
    if params.cols < 2 || params.cols > 41 {
        return Err(AppError::UnprocessableEntity(
            "Board width must be between 2 and 41".to_string(),
        ));
    }
    if params.rows < 2 || params.rows > 41 {
        return Err(AppError::UnprocessableEntity(
            "Board height must be between 2 and 41".to_string(),
        ));
    }

    // Handicap validation
    if params.handicap < 0 {
        return Err(AppError::UnprocessableEntity(
            "Handicap cannot be negative".to_string(),
        ));
    }
    // Check max handicap for board size
    let max_hc = go_engine::handicap::max_handicap(params.cols as u8, params.rows as u8);
    if params.handicap > 0 && max_hc == 0 {
        return Err(AppError::UnprocessableEntity(
            "Handicap is not supported for this board size".to_string(),
        ));
    }
    if params.handicap > max_hc as i32 {
        return Err(AppError::UnprocessableEntity(format!(
            "Maximum handicap for {}x{} board is {}",
            params.cols, params.rows, max_hc
        )));
    }

    let friend = if let Some(ref username) = params.invite_username {
        if !username.is_empty() {
            Some(
                User::find_by_username(pool, username)
                    .await?
                    .ok_or_else(|| {
                        AppError::UnprocessableEntity(format!("User '{username}' not found"))
                    })?,
            )
        } else {
            None
        }
    } else if let Some(ref email) = params.invite_email {
        if !email.is_empty() {
            Some(User::find_or_create_by_email(pool, email).await?)
        } else {
            None
        }
    } else {
        None
    };

    let friend_id = friend.as_ref().map(|f| f.id);

    let nigiri = !matches!(params.color.as_str(), "black" | "white");
    let (black_id, white_id) = match params.color.as_str() {
        "black" => (Some(creator.id), friend_id),
        "white" => (friend_id, Some(creator.id)),
        // Nigiri: assign deterministically now, randomize when game starts
        _ => (Some(creator.id), friend_id),
    };

    let invite_token = generate_invite_token();

    // Compute initial clock values for timed games
    let tc = TimeControl::from_tc_type(
        params.time_control,
        params.main_time_secs,
        params.increment_secs,
        params.byoyomi_time_secs,
        params.byoyomi_periods,
    );
    let initial_clock = ClockState::new(&tc);

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
        params.allow_undo,
        &invite_token,
        params.time_control,
        params.main_time_secs,
        params.increment_secs,
        params.byoyomi_time_secs,
        params.byoyomi_periods,
        initial_clock.as_ref().map(|c| c.black_remaining_ms),
        initial_clock.as_ref().map(|c| c.white_remaining_ms),
        initial_clock.as_ref().map(|c| c.black_periods),
        initial_clock.as_ref().map(|c| c.white_periods),
        nigiri,
    )
    .await?;

    // When both slots are filled at creation (invite game), set stage to "challenge"
    if friend.is_some() {
        Game::set_stage(pool, game.id, "challenge").await?;
    }

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
