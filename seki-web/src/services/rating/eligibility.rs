use crate::error::AppError;
use crate::models::game::TimeControlType;
use crate::models::rating::RatingProfile;
use crate::models::user::User;

#[derive(Debug, Clone, Copy)]
pub struct RankedCreateEligibility {
    pub is_private: bool,
    pub invite_only: bool,
    pub has_direct_opponent: bool,
    pub handicap: i32,
    pub komi: f64,
    pub time_control: TimeControlType,
}

pub fn can_participate_in_ranking(user: &User, profile: Option<&RatingProfile>) -> bool {
    user.is_registered() && profile.is_none_or(|p| p.participating)
}

pub fn can_create_ranked(
    creator: &User,
    profile: Option<&RatingProfile>,
    eligibility: RankedCreateEligibility,
) -> Result<(), AppError> {
    if !creator.is_registered() {
        return Err(AppError::UnprocessableEntity(
            "Only registered users can create ranked games".to_string(),
        ));
    }

    if profile.is_some_and(|p| !p.participating) {
        return Err(AppError::UnprocessableEntity(
            "You are not participating in ranked games, you must opt-in via settings to create a ranked game".to_string(),
        ));
    }

    if eligibility.is_private {
        return Err(AppError::UnprocessableEntity(
            "Private games cannot be ranked".to_string(),
        ));
    }

    if eligibility.invite_only {
        return Err(AppError::UnprocessableEntity(
            "Raw invite-only games cannot be ranked".to_string(),
        ));
    }

    if eligibility.time_control == TimeControlType::None {
        return Err(AppError::UnprocessableEntity(
            "Ranked games require a time control".to_string(),
        ));
    }

    let is_open_game = !eligibility.has_direct_opponent && !eligibility.invite_only;
    let is_direct_challenge = eligibility.has_direct_opponent && !eligibility.invite_only;

    if !(is_open_game || is_direct_challenge) {
        return Err(AppError::UnprocessableEntity(
            "Ranked games must be open games or direct challenges".to_string(),
        ));
    }

    // TODO: Update checks to Some/None after upstream type changes
    // TODO: Also enforce that color is None
    if eligibility.handicap != 0 || (eligibility.komi - 6.5).abs() > f64::EPSILON {
        return Err(AppError::UnprocessableEntity(
            "Ranked games use server-derived handicap and komi".to_string(),
        ));
    }
    Ok(())
}

pub fn can_join_ranked(user: &User, profile: Option<&RatingProfile>) -> Result<(), AppError> {
    if !user.is_registered() {
        return Err(AppError::UnprocessableEntity(
            "Only registered users can join ranked games".to_string(),
        ));
    }

    if profile.is_some_and(|p| !p.participating) {
        return Err(AppError::UnprocessableEntity(
            "You are not participating in ranked games".to_string(),
        ));
    }

    Ok(())
}

pub fn can_accept_ranked(user: &User, profile: Option<&RatingProfile>) -> Result<(), AppError> {
    if !user.is_registered() {
        return Err(AppError::UnprocessableEntity(
            "Only registered users can accept ranked challenges".to_string(),
        ));
    }

    if profile.is_some_and(|p| !p.participating) {
        return Err(AppError::UnprocessableEntity(
            "You are not participating in ranked games".to_string(),
        ));
    }

    Ok(())
}
