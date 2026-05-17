//! Rating policy, calculation, and DTO helpers.

mod eligibility;
mod profile;

use serde::{Deserialize, Serialize};
use skillratings::{
    Outcomes,
    glicko2::{Glicko2Config, Glicko2Rating, glicko2},
};

pub use eligibility::{
    RankedCreateEligibility, can_accept_ranked, can_create_ranked, can_join_ranked,
    can_participate_in_ranking,
};
pub use profile::{ProfileRatingDto, RatingHistoryEntryDto, profile_rating_summary};

use crate::db::DbPool;
use crate::error::AppError;
use crate::models::game::{Game, RankedGameSnapshotUpdate};
use crate::models::rating::{NewRatingAdjustment, RatingAdjustment, RatingProfile};
use crate::models::user::User;

pub const PROVISIONAL_DEVIATION_THRESHOLD: f64 = 110.0;
pub const DEFAULT_DISPLAY_MODE: RatingDisplayMode = RatingDisplayMode::KyuDan;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RatingDisplayMode {
    KyuDan,
    Rating,
}

impl RatingDisplayMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some("rating") => Self::Rating,
            _ => Self::KyuDan,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RankStatus {
    Anonymous,
    NotParticipating,
    Unranked,
    Ranked,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct RankDto {
    pub qualifier: Option<String>,
    pub status: RankStatus,
    pub rating: Option<f64>,
    pub deviation: Option<f64>,
    pub volatility: Option<f64>,
    pub uncertain: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatingSummaryDto {
    pub participating: bool,
    pub rating: f64,
    pub deviation: f64,
    pub volatility: f64,
    pub rank: RankDto,
    pub rated_games: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedSettingsDto {
    pub handicap: i32,
    pub komi: f64,
    pub color_reason: String,
    pub calibration_policy_version: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RatingUpdate {
    pub black_before: Glicko2Rating,
    pub white_before: Glicko2Rating,
    pub black_after: Glicko2Rating,
    pub white_after: Glicko2Rating,
}

#[derive(Debug, Clone, Copy)]
pub enum GameOutcome {
    BlackWin,
    WhiteWin,
    Draw,
}

impl GameOutcome {
    fn as_skillratings(self) -> Outcomes {
        match self {
            Self::BlackWin => Outcomes::WIN,
            Self::WhiteWin => Outcomes::LOSS,
            Self::Draw => Outcomes::DRAW,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct RatingCalibrationPolicy {
    pub version: &'static str,
    pub rating_per_rank: f64,
    pub even_game_komi: f64,
    pub handicap_komi: f64,
}

impl Default for RatingCalibrationPolicy {
    fn default() -> Self {
        Self {
            version: "provisional-v1",
            rating_per_rank: 100.0,
            even_game_komi: 6.5,
            handicap_komi: 0.5,
        }
    }
}

impl RatingCalibrationPolicy {
    pub fn rank_label(self, rating: f64) -> String {
        let rank_steps = ((rating - 1500.0) / self.rating_per_rank).round() as i32;
        if rank_steps >= 8 {
            format!("{}d", rank_steps - 7)
        } else {
            format!("{}k", 8 - rank_steps)
        }
    }

    pub fn handicap_steps(self, rating_gap: f64) -> i32 {
        (rating_gap.abs() / self.rating_per_rank)
            .floor()
            .clamp(0.0, 9.0) as i32
    }

    pub fn ranked_settings(self, black_rating: f64, white_rating: f64) -> RankedSettingsDto {
        let gap = (black_rating - white_rating).abs();
        let steps = self.handicap_steps(gap);
        RankedSettingsDto {
            handicap: if steps >= 2 { steps } else { 0 },
            komi: if steps >= 2 {
                self.handicap_komi
            } else {
                self.even_game_komi
            },
            color_reason: if (black_rating - white_rating).abs() < f64::EPSILON {
                "exact_rating_random".to_string()
            } else if black_rating < white_rating {
                "lower_rating_black".to_string()
            } else {
                "higher_rating_black".to_string()
            },
            calibration_policy_version: self.version.to_string(),
        }
    }
}

pub fn profile_to_rating(profile: &RatingProfile) -> Glicko2Rating {
    Glicko2Rating {
        rating: profile.rating,
        deviation: profile.deviation,
        volatility: profile.volatility,
    }
}

pub fn apply_glicko2(
    black: &RatingProfile,
    white: &RatingProfile,
    outcome: GameOutcome,
) -> RatingUpdate {
    let black_before = profile_to_rating(black);
    let white_before = profile_to_rating(white);
    let (black_after, white_after) = glicko2(
        &black_before,
        &white_before,
        &outcome.as_skillratings(),
        &Glicko2Config::default(),
    );

    RatingUpdate {
        black_before,
        white_before,
        black_after,
        white_after,
    }
}

pub async fn capture_ranked_snapshot(
    pool: &DbPool,
    game_id: i64,
    black_id: i64,
    white_id: i64,
    max_handicap: Option<i32>,
    ranked: bool,
) -> Result<(), AppError> {
    if ranked {
        let (black_profile, white_profile) = tokio::try_join!(
            RatingProfile::get_or_create(pool, black_id),
            RatingProfile::get_or_create(pool, white_id),
        )?;

        let policy = RatingCalibrationPolicy::default();
        let mut settings = policy.ranked_settings(black_profile.rating, white_profile.rating);
        if let Some(max) = max_handicap {
            settings.handicap = settings.handicap.min(max);
        }

        let snapshot = RankedGameSnapshotUpdate {
            ranked: true,
            black_rating_before: Some(black_profile.rating),
            white_rating_before: Some(white_profile.rating),
            black_deviation_before: Some(black_profile.deviation),
            white_deviation_before: Some(white_profile.deviation),
            black_volatility_before: Some(black_profile.volatility),
            white_volatility_before: Some(white_profile.volatility),
            derived_handicap: Some(settings.handicap),
            derived_komi: Some(settings.komi),
            derived_color_reason: Some(settings.color_reason),
            calibration_policy_version: Some(settings.calibration_policy_version),
            max_handicap,
        };

        Game::set_ranked_snapshot(pool, game_id, &snapshot).await?;
    } else {
        let (black_profile, white_profile) = tokio::try_join!(
            RatingProfile::find(pool, black_id),
            RatingProfile::find(pool, white_id),
        )?;

        let (black_profile, white_profile) = match (black_profile, white_profile) {
            (Some(bp), Some(wp)) => (bp, wp),
            _ => return Ok(()),
        };

        let snapshot = RankedGameSnapshotUpdate {
            ranked: false,
            black_rating_before: Some(black_profile.rating),
            white_rating_before: Some(white_profile.rating),
            black_deviation_before: Some(black_profile.deviation),
            white_deviation_before: Some(white_profile.deviation),
            black_volatility_before: Some(black_profile.volatility),
            white_volatility_before: Some(white_profile.volatility),
            derived_handicap: None,
            derived_komi: None,
            derived_color_reason: None,
            calibration_policy_version: None,
            max_handicap: None,
        };

        Game::set_ranked_snapshot(pool, game_id, &snapshot).await?;
    }

    Ok(())
}

pub async fn finalize_rating(
    pool: &DbPool,
    game: &Game,
    result: &str,
    black_id: i64,
    white_id: i64,
) -> Result<bool, AppError> {
    if !game.ranked {
        return Ok(false);
    }

    let (black_profile, white_profile) = tokio::try_join!(
        RatingProfile::get_or_create(pool, black_id),
        RatingProfile::get_or_create(pool, white_id),
    )?;

    let outcome = game_outcome_from_result(result);
    let update = apply_glicko2(&black_profile, &white_profile, outcome);
    let result_text = adjustment_result_for(result);

    let mut tx = pool.begin().await?;
    let applied = Game::set_rating_applied(&mut *tx, game.id).await?;
    if !applied {
        tx.commit().await?;
        return Ok(false);
    }

    RatingProfile::update_rating(
        &mut *tx,
        black_id,
        update.black_after.rating,
        update.black_after.deviation,
        update.black_after.volatility,
    )
    .await?;

    RatingProfile::update_rating(
        &mut *tx,
        white_id,
        update.white_after.rating,
        update.white_after.deviation,
        update.white_after.volatility,
    )
    .await?;

    RatingAdjustment::insert(
        &mut *tx,
        &NewRatingAdjustment {
            user_id: black_id,
            game_id: game.id,
            opponent_id: white_id,
            result: &result_text,
            rating_before: update.black_before.rating,
            rating_after: update.black_after.rating,
            deviation_before: update.black_before.deviation,
            deviation_after: update.black_after.deviation,
            volatility_before: update.black_before.volatility,
            volatility_after: update.black_after.volatility,
            opponent_rating_before: update.white_before.rating,
        },
    )
    .await?;

    RatingAdjustment::insert(
        &mut *tx,
        &NewRatingAdjustment {
            user_id: white_id,
            game_id: game.id,
            opponent_id: black_id,
            result: &result_text,
            rating_before: update.white_before.rating,
            rating_after: update.white_after.rating,
            deviation_before: update.white_before.deviation,
            deviation_after: update.white_after.deviation,
            volatility_before: update.white_before.volatility,
            volatility_after: update.white_after.volatility,
            opponent_rating_before: update.black_before.rating,
        },
    )
    .await?;

    tx.commit().await?;

    Ok(true)
}

fn game_outcome_from_result(result: &str) -> GameOutcome {
    if result.starts_with("B+") {
        GameOutcome::BlackWin
    } else if result.starts_with("W+") {
        GameOutcome::WhiteWin
    } else {
        GameOutcome::Draw
    }
}

fn adjustment_result_for(result: &str) -> String {
    result.to_string()
}

pub fn rank_for_profile(profile: Option<&RatingProfile>) -> RankDto {
    match profile {
        None => RankDto {
            qualifier: None,
            status: RankStatus::Anonymous,
            rating: None,
            deviation: None,
            volatility: None,
            uncertain: false,
        },
        Some(profile) if !profile.participating => RankDto {
            qualifier: Some("-".to_string()),
            status: RankStatus::NotParticipating,
            rating: Some(profile.rating),
            deviation: Some(profile.deviation),
            volatility: Some(profile.volatility),
            uncertain: false,
        },
        Some(profile) if profile.rated_games == 0 => RankDto {
            qualifier: Some("?".to_string()),
            status: RankStatus::Unranked,
            rating: Some(profile.rating),
            deviation: Some(profile.deviation),
            volatility: Some(profile.volatility),
            uncertain: true,
        },
        Some(profile) => {
            let policy = RatingCalibrationPolicy::default();
            RankDto {
                qualifier: Some(policy.rank_label(profile.rating)),
                status: RankStatus::Ranked,
                rating: Some(profile.rating),
                deviation: Some(profile.deviation),
                volatility: Some(profile.volatility),
                uncertain: profile.deviation > PROVISIONAL_DEVIATION_THRESHOLD,
            }
        }
    }
}

pub fn rank_for_user(user: &User, profile: Option<&RatingProfile>) -> RankDto {
    if !user.is_registered() {
        return RankDto {
            qualifier: None,
            status: RankStatus::Anonymous,
            rating: None,
            deviation: None,
            volatility: None,
            uncertain: false,
        };
    }

    match profile {
        None => RankDto {
            qualifier: Some("?".to_string()),
            status: RankStatus::Unranked,
            rating: None,
            deviation: None,
            volatility: None,
            uncertain: true,
        },
        Some(profile) => rank_for_profile(Some(profile)),
    }
}

pub fn primary_rank_text(rank: &RankDto, mode: RatingDisplayMode) -> Option<String> {
    match rank.status {
        RankStatus::Anonymous => None,
        RankStatus::NotParticipating => Some("(-)".to_string()),
        RankStatus::Unranked => Some("(?)".to_string()),
        RankStatus::Ranked => {
            let value = match mode {
                RatingDisplayMode::KyuDan => rank.qualifier.clone()?,
                RatingDisplayMode::Rating => format!("{:.0}", rank.rating?),
            };
            Some(format!(
                "({}{})",
                value,
                if rank.uncertain { "?" } else { "" }
            ))
        }
    }
}

pub fn alternate_rank_text(rank: &RankDto, mode: RatingDisplayMode) -> Option<String> {
    if rank.status != RankStatus::Ranked {
        return None;
    }

    let value = match mode {
        RatingDisplayMode::KyuDan => format!("{:.0}", rank.rating?),
        RatingDisplayMode::Rating => rank.qualifier.clone()?,
    };
    Some(format!(
        "{}{}",
        value,
        if rank.uncertain { "?" } else { "" }
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn profile(
        rating: f64,
        deviation: f64,
        participating: bool,
        rated_games: i32,
    ) -> RatingProfile {
        RatingProfile {
            user_id: 1,
            participating,
            rating,
            deviation,
            volatility: 0.06,
            rated_games,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn provisional_threshold_marks_ranked_profiles_uncertain() {
        let uncertain = profile(1500.0, 111.0, true, 1);
        let established = profile(1500.0, 110.0, true, 1);

        assert!(rank_for_profile(Some(&uncertain)).uncertain);
        assert!(!rank_for_profile(Some(&established)).uncertain);
    }

    #[test]
    fn rank_text_uses_display_preference_and_alternate_value() {
        let rank = rank_for_profile(Some(&profile(1500.0, 90.0, true, 1)));

        assert_eq!(
            primary_rank_text(&rank, RatingDisplayMode::KyuDan).as_deref(),
            Some("(8k)")
        );
        assert_eq!(
            alternate_rank_text(&rank, RatingDisplayMode::KyuDan).as_deref(),
            Some("1500")
        );
        assert_eq!(
            primary_rank_text(&rank, RatingDisplayMode::Rating).as_deref(),
            Some("(1500)")
        );
    }

    #[test]
    fn calibration_derives_handicap_from_rating_gap() {
        let policy = RatingCalibrationPolicy::default();

        let even = policy.ranked_settings(1500.0, 1580.0);
        let handicap = policy.ranked_settings(1300.0, 1600.0);

        assert_eq!(even.handicap, 0);
        assert_eq!(even.komi, 6.5);
        assert_eq!(handicap.handicap, 3);
        assert_eq!(handicap.komi, 0.5);
    }
}
