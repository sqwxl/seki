use askama::Template;

use crate::models::game::GameWithPlayers;

#[derive(Template)]
#[template(path = "games/list.html")]
pub struct GamesListTemplate {
    pub player_username: Option<String>,
    pub player_data: String,
    pub player_games: Vec<GameWithPlayers>,
    pub public_games: Vec<GameWithPlayers>,
}
