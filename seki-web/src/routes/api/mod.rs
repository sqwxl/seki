mod challenges;
mod game_actions;
mod games;
mod messages;
mod turns;
mod users;

use axum::routing::{get, post};
use axum::{Json, Router};
use tower_governor::GovernorLayer;
use tower_governor::governor::GovernorConfigBuilder;
use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};
use utoipa_scalar::{Scalar, Servable};

use crate::AppState;
use crate::routes::auth;
use crate::routes::fcm;
use crate::routes::push;

use self::challenges::{accept_challenge, decline_challenge, rematch_game};
use self::game_actions::{
    abort, approve_territory, pass, play_move, request_undo, resign, respond_to_undo, toggle_chain,
};
use self::games::{create_game, delete_game, get_game, join_game, list_games};
use self::messages::{get_messages, send_message};
use self::turns::get_turns;
use self::users::{get_me, get_user, get_user_games};

struct ApiModifier;

impl Modify for ApiModifier {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer",
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("token")
                        .description(Some(
                            "API token from the /settings page. Pass as `Authorization: Bearer <token>`.",
                        ))
                        .build(),
                ),
            );
        }

        let old = std::mem::take(&mut openapi.paths.paths);
        openapi.paths.paths = old
            .into_iter()
            .map(|(path, item)| (format!("/api{path}"), item))
            .collect();
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Seki API",
        description = "API for the Seki Go game server. Errors use the envelope `{ \"error\": { \"code\": string, \"message\": string } }`.",
        version = "0.1.0"
    ),
    paths(
        games::list_games, games::create_game, games::get_game, games::delete_game, games::join_game,
        game_actions::play_move, game_actions::pass, game_actions::resign, game_actions::abort,
        game_actions::request_undo, game_actions::respond_to_undo,
        game_actions::toggle_chain, game_actions::approve_territory,
        challenges::accept_challenge, challenges::decline_challenge, challenges::rematch_game,
        messages::get_messages, messages::send_message, turns::get_turns,
        users::get_user, users::get_user_games, users::get_me
    ),
    components(schemas(
        users::UserResponse, games::GameResponse, turns::TurnResponse, messages::MessageResponse,
        games::CreateGameRequest, game_actions::PlayRequest, game_actions::UndoResponseRequest, game_actions::ToggleChainRequest,
        messages::ChatRequest, challenges::RematchRequest, games::JoinGameRequest,
        crate::services::live::LiveGameItem,
        crate::services::live::GameSettings,
        crate::models::game::TimeControlType,
        crate::views::UserData,
        crate::error::ApiErrorResponse,
        crate::error::ApiErrorDetail
    )),
    modifiers(&ApiModifier),
    tags(
        (name = "Games", description = "Game CRUD and joining"),
        (name = "Game Actions", description = "In-game moves, pass, resign, undo, territory"),
        (name = "Messages", description = "In-game chat"),
        (name = "Turns", description = "Move history"),
        (name = "Users", description = "User profiles and game history"),
        (name = "Auth", description = "Current user info")
    )
)]
pub struct ApiDoc;

const SCALAR_HTML: &str = r#"<!doctype html>
<html>
<head>
  <title>Seki API</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
</head>
<body>
  <script id="api-reference" data-configuration='{"agent":{"disabled":true}}' type="application/json">$spec</script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>"#;

pub fn router() -> Router<AppState> {
    let spec = ApiDoc::openapi();

    Router::new()
        .route(
            "/openapi.json",
            get({
                let spec = spec.clone();
                move || async move { Json(spec) }
            }),
        )
        .merge(Scalar::with_url("/docs", spec).custom_html(SCALAR_HTML))
        // Auth
        .route("/auth/token", get(auth::issue_token))
        .route("/auth/restore", get(auth::restore_session))
        .route("/auth/token", axum::routing::delete(auth::revoke_token))
        // Push subscriptions
        .route("/push-subscription", get(push::list_subscriptions))
        .route("/push-subscription", post(push::register_subscription))
        .route(
            "/push-subscription/{id}",
            axum::routing::delete(push::disable_subscription),
        )
        // FCM tokens
        .route("/fcm-token", post(fcm::register_fcm_token))
        .route(
            "/fcm-token/{id}",
            axum::routing::delete(fcm::delete_fcm_token),
        )
        // Games
        .route("/games", get(list_games))
        .route(
            "/games",
            post(create_game).layer(GovernorLayer::new(
                GovernorConfigBuilder::default()
                    .per_second(1)
                    .burst_size(30)
                    .use_headers()
                    .finish()
                    .expect("valid rate limit config"),
            )),
        )
        .route("/games/{id}", get(get_game).delete(delete_game))
        .route("/games/{id}/join", post(join_game))
        // Game actions
        .route("/games/{id}/play", post(play_move))
        .route("/games/{id}/pass", post(pass))
        .route("/games/{id}/resign", post(resign))
        .route("/games/{id}/abort", post(abort))
        .route("/games/{id}/undo", post(request_undo))
        .route("/games/{id}/undo/respond", post(respond_to_undo))
        .route("/games/{id}/territory/toggle", post(toggle_chain))
        .route("/games/{id}/territory/approve", post(approve_territory))
        .route("/games/{id}/accept", post(accept_challenge))
        .route("/games/{id}/decline", post(decline_challenge))
        .route("/games/{id}/rematch", post(rematch_game))
        // Messages
        .route("/games/{id}/messages", get(get_messages).post(send_message))
        // Turns
        .route("/games/{id}/turns", get(get_turns))
        // Users
        .route("/users/{username}", get(get_user))
        .route("/users/{username}/games", get(get_user_games))
        // Auth
        .route("/me", get(get_me))
}
