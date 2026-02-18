use askama::Template;

#[derive(Template)]
#[template(path = "auth/register.html")]
pub struct RegisterTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
    pub flash: Option<String>,
}

#[derive(Template)]
#[template(path = "auth/login.html")]
pub struct LoginTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
    pub flash: Option<String>,
    pub redirect: String,
}
