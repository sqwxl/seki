use askama::Template;

#[derive(Template)]
#[template(path = "analysis.html")]
pub struct AnalysisTemplate {
    pub user_username: String,
    pub user_is_registered: bool,
    pub user_data: String,
}
