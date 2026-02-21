use askama::Template;

#[derive(Template)]
#[template(path = "games/list.html")]
pub struct GamesListTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
    pub initial_games: String,
}
