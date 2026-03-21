use askama::Template;
use axum::response::{Html, IntoResponse, Response};

use crate::error::AppError;
use crate::routes::serialize_user_data;
use crate::session::CurrentUser;
use crate::templates::shell::SpaShellTemplate;

pub async fn shell(current_user: CurrentUser) -> Result<Response, AppError> {
    let tmpl = SpaShellTemplate {
        user_data: serialize_user_data(&current_user),
    };
    Ok(Html(tmpl.render()?).into_response())
}
