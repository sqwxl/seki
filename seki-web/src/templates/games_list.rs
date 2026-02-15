use askama::Template;

use crate::models::game::GameWithPlayers;

#[derive(Template)]
#[template(path = "games/list.html")]
pub struct GamesListTemplate {
    pub player_username: String,
    pub player_is_registered: bool,
    pub player_data: String,
    pub player_games: Vec<GameWithPlayers>,
    pub public_games: Vec<GameWithPlayers>,
}
