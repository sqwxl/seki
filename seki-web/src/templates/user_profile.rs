use askama::Template;

#[derive(Template)]
#[template(path = "users/profile.html")]
pub struct UserProfileTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
    pub profile_username: String,
    pub initial_games: String,
}
