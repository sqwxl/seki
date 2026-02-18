use askama::Template;

#[derive(Template)]
#[template(path = "games/new.html")]
pub struct GamesNewTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
    pub flash: Option<String>,
}
