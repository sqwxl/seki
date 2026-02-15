use askama::Template;

#[derive(Template)]
#[template(path = "games/new.html")]
pub struct GamesNewTemplate {
    pub player_username: String,
    pub player_is_registered: bool,
    pub player_data: String,
    pub flash: Option<String>,
}
