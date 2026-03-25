use askama::Template;
use axum::extract::{OriginalUri, State};
use axum::http::Uri;
use axum::response::{Html, IntoResponse, Redirect, Response};
use tower_sessions::Session;

use crate::AppState;
use crate::error::AppError;
use crate::routes::{FlashMessage, FlashSeverity, serialize_user_data, set_flash, take_flash};
use crate::routes::web_api::bootstrap_for_location;
use crate::session::CurrentUser;
use crate::templates::shell::SpaShellTemplate;

pub async fn shell(
    State(state): State<AppState>,
    OriginalUri(uri): OriginalUri,
    session: Session,
    current_user: CurrentUser,
) -> Result<Response, AppError> {
    let bootstrap = match bootstrap_for_location(&state, &current_user, &uri).await {
        Ok(payload) => payload,
        Err(error) => {
            if let Some(target) = redirect_target_for_navigation_error(&session, &uri, &error).await? {
                return Ok(Redirect::to(&target).into_response());
            }
            return Err(error);
        }
    };
    let mut bootstrap = bootstrap;
    bootstrap.flash = take_flash(&session).await?;
    let bootstrap_json = serde_json::to_string(&bootstrap)?;
    let tmpl = SpaShellTemplate {
        user_data: serialize_user_data(&current_user),
        bootstrap_json,
    };
    Ok(Html(tmpl.render()?).into_response())
}

async fn redirect_target_for_navigation_error(
    session: &Session,
    uri: &Uri,
    error: &AppError,
) -> Result<Option<String>, AppError> {
    let path = uri.path();
    if let Some(id) = game_id_from_path(path) {
        return match error {
            AppError::NotFound(_) => {
                set_flash(
                    session,
                    FlashMessage {
                        message: format!("The game you were looking for (ID {id}) does not exist"),
                        severity: FlashSeverity::Error,
                    },
                )
                .await?;
                Ok(Some("/games".to_string()))
            }
            AppError::Forbidden(message) => {
                set_flash(
                    session,
                    FlashMessage {
                        message: message.clone(),
                        severity: FlashSeverity::Error,
                    },
                )
                .await?;
                Ok(Some("/games".to_string()))
            }
            AppError::Unauthorized(_) => {
                set_flash(
                    session,
                    FlashMessage {
                        message: "Please log in to view this page".to_string(),
                        severity: FlashSeverity::Error,
                    },
                )
                .await?;
                let query = serde_urlencoded::to_string([("redirect", path_and_query(uri))])
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                Ok(Some(format!("/login?{query}")))
            }
            _ => Ok(None),
        };
    }

    Ok(None)
}

fn game_id_from_path(path: &str) -> Option<i64> {
    let id = path.strip_prefix("/games/")?;
    if id.contains('/') {
        return None;
    }
    id.parse().ok()
}

fn path_and_query(uri: &Uri) -> String {
    match uri.query() {
        Some(query) => format!("{}?{query}", uri.path()),
        None => uri.path().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::redirect_target_for_navigation_error;
    use crate::error::AppError;
    use tower_sessions::{MemoryStore, Session};

    #[tokio::test]
    async fn missing_game_redirects_to_games_with_spec_flash() {
        let uri: axum::http::Uri = "/games/124".parse().expect("uri");
        let session = Session::new(None, MemoryStore::default().into(), None);
        let redirect = redirect_target_for_navigation_error(
            &session,
            &uri,
            &AppError::NotFound("Game not found".to_string()),
        )
        .await
        .expect("redirect result");
        assert_eq!(redirect.as_deref(), Some("/games"));
        let flash = session
            .get::<crate::routes::FlashMessage>("flash")
            .await
            .expect("flash get")
            .expect("flash set");
        assert_eq!(
            flash.message,
            "The game you were looking for (ID 124) does not exist"
        );
    }
}
