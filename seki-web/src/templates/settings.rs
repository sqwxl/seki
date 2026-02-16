use askama::Template;

#[derive(Template)]
#[template(path = "settings.html")]
pub struct SettingsTemplate {
    pub player_username: String,
    pub player_is_registered: bool,
    pub player_data: String,
    pub api_token: Option<String>,
    pub flash: Option<String>,
}
