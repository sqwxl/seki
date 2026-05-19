use rand::RngExt;

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::{Game, TimeControlType};
use crate::models::rating::RatingProfile;
use crate::models::user::User;
use crate::services::clock::{ClockState, TimeControl};
use crate::services::rating;

const MAX_CORRESPONDENCE_DAYS: i32 = 30;
const SECS_PER_DAY: i32 = 86_400;

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
    pub open_to: Option<String>,
    pub ranked: bool,
    pub rating_range: RatingRangePreference,
    pub open_game: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RatingRangePreference {
    Unlimited,
    Absolute(i32),
}

impl RatingRangePreference {
    pub fn validate(&self) -> Result<(), AppError> {
        match self {
            Self::Unlimited => Ok(()),
            Self::Absolute(value) if *value >= 0 => Ok(()),
            Self::Absolute(_) => Err(AppError::UnprocessableEntity(
                "Max rating difference cannot be negative".to_string(),
            )),
        }
    }

    pub fn db_values(&self) -> (&'static str, Option<i32>, Option<i32>, bool, bool) {
        match self {
            Self::Unlimited => ("unlimited", None, None, true, true),
            Self::Absolute(value) => ("absolute", Some(*value), Some(*value), false, false),
        }
    }
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

    params.rating_range.validate()?;

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

    if params.time_control == TimeControlType::Correspondence
        && params
            .main_time_secs
            .is_some_and(|secs| secs > MAX_CORRESPONDENCE_DAYS * SECS_PER_DAY)
    {
        return Err(AppError::UnprocessableEntity(
            "Correspondence games support at most 30 days per move".to_string(),
        ));
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
            // If a user with this email exists, create a challenge with them.
            // Otherwise leave the slot empty — they join via the invitation link.
            User::find_by_email(pool, email).await?
        } else {
            None
        }
    } else {
        None
    };

    // A raw email invite does not assign the second seat yet.
    // Mark it invite-only so only the token holder can fill that seat.
    let invite_only =
        params.invite_email.as_ref().is_some_and(|e| !e.is_empty()) && friend.is_none();
    let is_private = params.is_private || invite_only;

    if params.ranked {
        let creator_profile = RatingProfile::find(pool, creator.id).await?;
        rating::can_create_ranked(
            creator,
            creator_profile.as_ref(),
            rating::RankedCreateEligibility {
                is_private: params.is_private,
                invite_only,
                has_direct_opponent: friend.is_some(),
                handicap: params.handicap,
                komi: params.komi,
                time_control: params.time_control,
            },
        )?;
        if let Some(opponent) = friend.as_ref() {
            let opponent_profile = RatingProfile::find(pool, opponent.id).await?;
            rating::can_join_ranked(opponent, opponent_profile.as_ref())?;
        }
        RatingProfile::get_or_create(pool, creator.id).await?;
    }

    let friend_id = friend.as_ref().map(|f| f.id);

    let nigiri = !matches!(params.color.as_str(), "black" | "white");
    let (black_id, white_id) = if params.open_game {
        (None, None)
    } else {
        match params.color.as_str() {
            "black" => (Some(creator.id), friend_id),
            "white" => (friend_id, Some(creator.id)),
            // Random colors are finalized when the game actually starts.
            _ => (None, None),
        }
    };

    let access_token = generate_game_token();
    let invite_token = invite_only.then(generate_game_token);

    // Compute initial clock values for timed games
    let tc = TimeControl::from_tc_type(
        params.time_control,
        params.main_time_secs,
        params.increment_secs,
        params.byoyomi_time_secs,
        params.byoyomi_periods,
    );
    let initial_clock = ClockState::new(&tc);

    let (
        rating_range_mode,
        max_rating_difference_lower,
        max_rating_difference_higher,
        lower_unlimited,
        higher_unlimited,
    ) = params.rating_range.db_values();

    let game = Game::create(
        pool,
        creator.id,
        friend_id,
        black_id,
        white_id,
        params.cols,
        params.rows,
        params.komi,
        params.handicap,
        is_private,
        params.allow_undo,
        &access_token,
        invite_token.as_deref(),
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
        params.open_to.as_deref(),
        invite_only,
        params.ranked,
        rating_range_mode,
        max_rating_difference_lower,
        max_rating_difference_higher,
        lower_unlimited,
        higher_unlimited,
    )
    .await?;

    if black_id.is_some()
        && white_id.is_some()
        && let Err(e) = rating::capture_ranked_snapshot(
            pool,
            game.id,
            black_id.unwrap(),
            white_id.unwrap(),
            params.ranked,
        )
        .await
    {
        tracing::warn!(
            game_id = game.id,
            error = %e,
            "Failed to capture ranked snapshot during game creation"
        );
    }

    // When both seats are assigned up front, this is a direct challenge:
    // the invited player must accept or decline before play starts.
    if friend.is_some() {
        Game::set_stage(pool, game.id, "challenge").await?;
    }

    Ok(game)
}

fn generate_game_token() -> String {
    let mut rng = rand::rng();
    (0..22)
        .map(|_| {
            let idx = rng.random_range(0..62);
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[idx] as char
        })
        .collect()
}
