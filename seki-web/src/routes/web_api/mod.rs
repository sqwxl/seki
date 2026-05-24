mod games;
mod settings;
mod users;

use axum::Router;
use axum::http::Uri;
use serde::Serialize;

use crate::AppState;
use crate::error::AppError;
use crate::routes::flash::FlashMessage;
use crate::session::CurrentUser;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/session/me", axum::routing::get(settings::session_me))
        .route(
            "/web/vapid-public-key",
            axum::routing::get(crate::routes::push::vapid_public_key),
        )
        .route("/web/games", axum::routing::get(games::games_index))
        .route("/web/games/new", axum::routing::get(games::new_game))
        .route("/web/games/{id}", axum::routing::get(games::game_show))
        .route("/web/analysis", axum::routing::get(games::analysis))
        .route(
            "/web/users/{username}",
            axum::routing::get(users::user_profile),
        )
}

#[derive(Serialize)]
pub(crate) struct BootstrapPayload {
    pub url: Option<String>,
    pub data: Option<serde_json::Value>,
    pub flash: Option<FlashMessage>,
}

pub(crate) async fn bootstrap_for_location(
    state: &AppState,
    current_user: &CurrentUser,
    uri: &Uri,
) -> Result<BootstrapPayload, AppError> {
    let path = uri.path();
    let query = uri.query();
    let Some(url) = route_data_url(path, query) else {
        return Ok(BootstrapPayload {
            url: None,
            data: None,
            flash: None,
        });
    };

    let data = match path {
        "/" | "/games" | "/games/spectate" => serde_json::to_value(
            games::load_games_index(
                state,
                current_user,
                crate::models::game_read::GameListRatingFilters::default(),
            )
            .await?,
        )?,
        "/games/new" => serde_json::to_value(
            games::load_new_game(state, current_user, query_param(query, "opponent")).await?,
        )?,
        _ if path.starts_with("/games/challenge/") => {
            let username = path.trim_start_matches("/games/challenge/").to_string();
            serde_json::to_value(games::load_new_game(state, current_user, Some(username)).await?)?
        }
        "/analysis" => serde_json::to_value(games::AnalysisData {})?,
        _ if path.starts_with("/games/") => {
            let game_id = path
                .trim_start_matches("/games/")
                .parse::<i64>()
                .map_err(|_| AppError::NotFound("Game not found".to_string()))?;
            let access_token = query_param(query, "access_token");
            let invite_token = query_param(query, "invite_token");
            let mut params = Vec::new();

            if let Some(token) = access_token {
                params.push(format!("access_token={token}"));
            }

            if let Some(token) = invite_token {
                params.push(format!("invite_token={token}"));
            }

            serde_json::to_value(
                games::load_game_show(state, current_user, game_id, params).await?,
            )?
        }
        _ if path.starts_with("/users/") => {
            let username = path.trim_start_matches("/users/").to_string();
            serde_json::to_value(users::load_user_profile(state, current_user, username).await?)?
        }
        _ => {
            return Ok(BootstrapPayload {
                url: None,
                data: None,
                flash: None,
            });
        }
    };

    Ok(BootstrapPayload {
        url: Some(url),
        data: Some(data),
        flash: None,
    })
}

fn route_data_url(path: &str, query: Option<&str>) -> Option<String> {
    match path {
        "/" | "/games" | "/games/spectate" => Some("/api/web/games".to_string()),
        "/games/new" => {
            let opponent = query_param(query, "opponent");
            Some(match opponent {
                Some(opponent) => format!("/api/web/games/new?opponent={opponent}"),
                None => "/api/web/games/new".to_string(),
            })
        }
        "/analysis" => Some("/api/web/analysis".to_string()),
        _ if path.starts_with("/games/challenge/") => {
            let username = path.trim_start_matches("/games/challenge/");
            Some(format!("/api/web/games/new?opponent={}", username))
        }
        _ if path.starts_with("/games/") => {
            let access_token = query_param(query, "access_token");
            let invite_token = query_param(query, "invite_token");
            let mut params = Vec::new();
            if let Some(token) = access_token {
                params.push(format!("access_token={token}"));
            }
            if let Some(token) = invite_token {
                params.push(format!("invite_token={token}"));
            }
            Some(if params.is_empty() {
                path.replacen("/games", "/api/web/games", 1)
            } else {
                format!("{path}?{}", params.join("&")).replacen("/games", "/api/web/games", 1)
            })
        }
        _ if path.starts_with("/users/") => Some(path.replacen("/users", "/api/web/users", 1)),
        _ => None,
    }
}

fn query_param(query: Option<&str>, key: &str) -> Option<String> {
    query.and_then(|query| {
        query.split('&').find_map(|pair| {
            let mut parts = pair.splitn(2, '=');
            let k = parts.next()?;
            let v = parts.next().unwrap_or_default();
            if k == key { Some(v.to_string()) } else { None }
        })
    })
}
