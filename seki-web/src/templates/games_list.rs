use askama::Template;

#[derive(Template)]
#[template(path = "games/list.html")]
pub struct GamesListTemplate {
    pub player_username: String,
    pub player_is_registered: bool,
    pub player_data: String,
}
