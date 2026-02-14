use askama::Template;

#[derive(Template)]
#[template(path = "games/new.html")]
pub struct GamesNewTemplate {
    pub player_username: Option<String>,
    pub player_data: String,
    pub flash: Option<String>,
}
