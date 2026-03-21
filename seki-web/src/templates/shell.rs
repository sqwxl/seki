use askama::Template;

#[derive(Template)]
#[template(path = "spa_shell.html")]
pub struct SpaShellTemplate {
    pub user_data: String,
}
