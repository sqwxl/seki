use askama::Template;

#[derive(Template)]
#[template(path = "games/new.html")]
pub struct GamesNewTemplate {
    pub flash: Option<String>,
}
