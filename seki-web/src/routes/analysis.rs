use askama::Template;
use axum::response::{Html, IntoResponse, Response};

use crate::error::AppError;
use crate::routes::serialize_user_data;
use crate::session::CurrentUser;
use crate::templates::analysis::AnalysisTemplate;

// GET /analysis
pub async fn analysis_board(current_user: CurrentUser) -> Result<Response, AppError> {
    let tmpl = AnalysisTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: current_user.is_registered(),
        user_data: serialize_user_data(&current_user),
    };
    Ok(Html(tmpl.render()?).into_response())
}
