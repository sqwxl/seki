use askama::Template;
use axum::response::{Html, IntoResponse, Response};

use crate::error::AppError;
use crate::session::CurrentUser;
use crate::templates::UserData;
use crate::templates::analysis::AnalysisTemplate;

fn serialize_user_data(user: &CurrentUser) -> String {
    serde_json::to_string(&UserData::from(&user.user)).unwrap_or_else(|_| "{}".to_string())
}

// GET /analysis
pub async fn analysis_board(current_user: CurrentUser) -> Result<Response, AppError> {
    let tmpl = AnalysisTemplate {
        user_username: current_user.username.clone(),
        user_is_registered: current_user.is_registered(),
        user_data: serialize_user_data(&current_user),
    };
    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}
