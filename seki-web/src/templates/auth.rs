use askama::Template;

#[derive(Template)]
#[template(path = "auth/register.html")]
pub struct RegisterTemplate {
    pub player_username: String,
    pub player_is_registered: bool,
    pub player_data: String,
    pub flash: Option<String>,
}

#[derive(Template)]
#[template(path = "auth/login.html")]
pub struct LoginTemplate {
    pub player_username: String,
    pub player_is_registered: bool,
    pub player_data: String,
    pub flash: Option<String>,
}
