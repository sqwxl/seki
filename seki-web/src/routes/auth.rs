use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use askama::Template;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::Form;
use serde::Deserialize;
use tower_sessions::Session;

use crate::error::AppError;
use crate::models::player::Player;
use crate::session::{CurrentPlayer, PLAYER_ID_KEY};
use crate::templates::auth::{LoginTemplate, RegisterTemplate};
use crate::templates::PlayerData;
use crate::AppState;

fn serialize_player_data(player: &CurrentPlayer) -> String {
    serde_json::to_string(&PlayerData::from(&player.player)).unwrap_or_else(|_| "{}".to_string())
}

#[derive(Deserialize)]
pub struct RegisterForm {
    pub username: String,
    pub password: String,
    pub password_confirmation: String,
}

#[derive(Deserialize)]
pub struct LoginForm {
    pub username: String,
    pub password: String,
}

// GET /register
pub async fn register_form(current_player: CurrentPlayer) -> Result<Response, AppError> {
    if current_player.is_registered() {
        return Ok(Redirect::to("/").into_response());
    }
    let tmpl = RegisterTemplate {
        player_username: None,
        player_data: serialize_player_data(&current_player),
        flash: None,
    };
    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}

// POST /register
pub async fn register(
    State(state): State<AppState>,
    current_player: CurrentPlayer,
    Form(form): Form<RegisterForm>,
) -> Result<Response, AppError> {
    if current_player.is_registered() {
        return Ok(Redirect::to("/").into_response());
    }

    let username = form.username.trim().to_string();
    let player_data = serialize_player_data(&current_player);
    let render_error = |msg: String| -> Result<Response, AppError> {
        let tmpl = RegisterTemplate {
            player_username: None,
            player_data: player_data.clone(),
            flash: Some(msg),
        };
        Ok((
            StatusCode::UNPROCESSABLE_ENTITY,
            Html(
                tmpl.render()
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            ),
        )
            .into_response())
    };

    // Validate
    if username.is_empty() || username.len() > 30 {
        return render_error("Username must be between 1 and 30 characters.".to_string());
    }
    if form.password.len() < 8 {
        return render_error("Password must be at least 8 characters.".to_string());
    }
    if form.password != form.password_confirmation {
        return render_error("Passwords do not match.".to_string());
    }

    // Check uniqueness
    if Player::find_by_username(&state.db, &username)
        .await?
        .is_some()
    {
        return render_error("Username is already taken.".to_string());
    }

    // Hash password
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(form.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hash error: {e}")))?
        .to_string();

    Player::set_credentials(&state.db, current_player.id, &username, &password_hash).await?;

    Ok(Redirect::to("/").into_response())
}

// GET /login
pub async fn login_form(current_player: CurrentPlayer) -> Result<Response, AppError> {
    if current_player.is_registered() {
        return Ok(Redirect::to("/").into_response());
    }
    let tmpl = LoginTemplate {
        player_username: None,
        player_data: serialize_player_data(&current_player),
        flash: None,
    };
    Ok(Html(
        tmpl.render()
            .map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .into_response())
}

// POST /login
pub async fn login(
    State(state): State<AppState>,
    session: Session,
    Form(form): Form<LoginForm>,
) -> Result<Response, AppError> {
    let render_error = |msg: String| -> Result<Response, AppError> {
        let tmpl = LoginTemplate {
            player_username: None,
            player_data: "{}".to_string(),
            flash: Some(msg),
        };
        Ok((
            StatusCode::UNPROCESSABLE_ENTITY,
            Html(
                tmpl.render()
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            ),
        )
            .into_response())
    };

    let player = match Player::find_by_username(&state.db, form.username.trim()).await? {
        Some(p) => p,
        None => return render_error("Invalid username or password.".to_string()),
    };

    let stored_hash = match &player.password_hash {
        Some(h) => h.clone(),
        None => return render_error("Invalid username or password.".to_string()),
    };

    let parsed_hash = PasswordHash::new(&stored_hash)
        .map_err(|e| AppError::Internal(format!("Password hash parse error: {e}")))?;

    if Argon2::default()
        .verify_password(form.password.as_bytes(), &parsed_hash)
        .is_err()
    {
        return render_error("Invalid username or password.".to_string());
    }

    // Switch session to this player's token
    let token = player
        .session_token
        .as_ref()
        .ok_or_else(|| AppError::Internal("Registered player has no session token".to_string()))?;
    session
        .insert(PLAYER_ID_KEY, token.clone())
        .await
        .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;

    Ok(Redirect::to("/").into_response())
}

// POST /logout
pub async fn logout(session: Session) -> Result<Response, AppError> {
    session
        .flush()
        .await
        .map_err(|e| AppError::Internal(format!("Session flush error: {e}")))?;
    Ok(Redirect::to("/").into_response())
}
