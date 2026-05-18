use askama::Template;

#[derive(Template)]
#[template(path = "spa_shell.html")]
pub struct SpaShellTemplate {
    pub bootstrap_json: String,
}
