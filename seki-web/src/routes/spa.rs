use askama::Template;
use axum::extract::{OriginalUri, State};
use axum::response::{Html, IntoResponse, Response};

use crate::AppState;
use crate::error::AppError;
use crate::routes::serialize_user_data;
use crate::routes::web_api::bootstrap_for_location;
use crate::session::CurrentUser;
use crate::templates::shell::SpaShellTemplate;

pub async fn shell(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    current_user: CurrentUser,
) -> Result<Response, AppError> {
    let bootstrap_json =
        serde_json::to_string(&bootstrap_for_location(&state, &current_user, &uri).await?)?;
    let tmpl = SpaShellTemplate {
        user_data: serialize_user_data(&current_user),
        bootstrap_json,
    };
    Ok(Html(tmpl.render()?).into_response())
}
