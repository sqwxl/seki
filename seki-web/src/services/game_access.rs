use crate::error::AppError;
use crate::models::game::GameWithPlayers;

#[derive(Debug, Clone, Copy, Default)]
pub struct GameViewTokens<'a> {
    pub access_token: Option<&'a str>,
    pub invite_token: Option<&'a str>,
}

pub fn is_protected(gwp: &GameWithPlayers) -> bool {
    gwp.game.is_private || gwp.game.invite_only
}

pub fn has_participant_access(gwp: &GameWithPlayers, user_id: i64) -> bool {
    gwp.has_player(user_id) || gwp.creator.as_ref().is_some_and(|u| u.id == user_id)
}

pub fn has_valid_token(gwp: &GameWithPlayers, tokens: GameViewTokens<'_>) -> bool {
    gwp.game
        .access_token
        .as_deref()
        .zip(tokens.access_token)
        .is_some_and(|(game_token, request_token)| game_token == request_token)
        || gwp
            .game
            .invite_token
            .as_deref()
            .zip(tokens.invite_token)
            .is_some_and(|(game_token, request_token)| game_token == request_token)
}

/// Validate that the provided access/invite tokens match the game's tokens
/// when the game requires them to join.
pub fn check_join_tokens(
    gwp: &GameWithPlayers,
    access_token: Option<&str>,
    invite_token: Option<&str>,
) -> Result<(), AppError> {
    let has_valid_access_token = gwp
        .game
        .access_token
        .as_deref()
        .zip(access_token)
        .is_some_and(|(game_tok, request_tok)| game_tok == request_tok);
    let has_valid_invite_token = gwp
        .game
        .invite_token
        .as_deref()
        .zip(invite_token)
        .is_some_and(|(game_tok, request_tok)| game_tok == request_tok);

    if gwp.game.requires_access_token_to_join() && !has_valid_access_token {
        return Err(AppError::UnprocessableEntity(
            "This game requires a valid access token to join".to_string(),
        ));
    }
    if gwp.game.requires_invite_token_to_join() && !has_valid_invite_token {
        return Err(AppError::UnprocessableEntity(
            "This game requires a valid invite token to join".to_string(),
        ));
    }
    Ok(())
}

pub fn can_view_game(
    gwp: &GameWithPlayers,
    user_id: Option<i64>,
    tokens: GameViewTokens<'_>,
) -> bool {
    !is_protected(gwp)
        || user_id.is_some_and(|id| has_participant_access(gwp, id))
        || has_valid_token(gwp, tokens)
}
