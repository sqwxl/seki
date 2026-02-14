use askama::Template;

#[derive(Template)]
#[template(path = "analysis.html")]
pub struct AnalysisTemplate {
    pub player_username: Option<String>,
    pub player_data: String,
}
