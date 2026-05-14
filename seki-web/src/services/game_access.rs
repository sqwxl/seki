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

pub fn can_view_game(
    gwp: &GameWithPlayers,
    user_id: Option<i64>,
    tokens: GameViewTokens<'_>,
) -> bool {
    !is_protected(gwp)
        || user_id.is_some_and(|id| has_participant_access(gwp, id))
        || has_valid_token(gwp, tokens)
}
