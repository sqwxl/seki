use askama::Template;

#[derive(Template)]
#[template(path = "settings.html")]
pub struct SettingsTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
    pub api_token: Option<String>,
    pub flash: Option<String>,
}
