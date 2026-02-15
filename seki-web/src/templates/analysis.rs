use askama::Template;

#[derive(Template)]
#[template(path = "analysis.html")]
pub struct AnalysisTemplate {
    pub player_username: String,
    pub player_is_registered: bool,
    pub player_data: String,
}
