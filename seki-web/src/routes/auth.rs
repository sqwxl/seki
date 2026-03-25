use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::Form;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use serde::Deserialize;
use serde_json::json;
use tower_sessions::Session;

use crate::AppState;
use crate::error::AppError;
use crate::models::user::User;
use crate::routes::{FlashMessage, FlashSeverity, flash_redirect, wants_json};
use crate::session::{ANON_USER_TOKEN_COOKIE, CurrentUser, USER_ID_KEY};

fn referer_path(headers: &axum::http::HeaderMap) -> String {
    headers
        .get(axum::http::header::REFERER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<axum::http::Uri>().ok())
        .map(|uri| uri.path().to_owned())
        .unwrap_or_default()
}

fn get_cookie(headers: &axum::http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(axum::http::header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|c| {
            c.trim()
                .strip_prefix(name)?
                .strip_prefix('=')
                .map(String::from)
        })
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

// POST /register
pub async fn register(
    State(state): State<AppState>,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    Form(form): Form<RegisterForm>,
) -> Result<Response, AppError> {
    if current_user.is_registered() {
        return Ok(Redirect::to("/").into_response());
    }

    let username = form.username.trim().to_string();
    let json = wants_json(&headers);
    let redirect_error = |msg: &str| -> Result<Response, AppError> {
        let url = flash_redirect(
            "/register",
            FlashMessage {
                message: msg.to_string(),
                severity: FlashSeverity::Error,
            },
        )?;
        Ok(Redirect::to(&url).into_response())
    };

    // Validate
    if username.is_empty() || username.len() > 30 {
        let msg = "Username must be between 1 and 30 characters.";
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::Json(json!({"error": msg, "field": "username"})),
            )
                .into_response());
        }
        return redirect_error(msg);
    }
    if form.password.len() < 8 {
        let msg = "Password must be at least 8 characters.";
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::Json(json!({"error": msg, "field": "password"})),
            )
                .into_response());
        }
        return redirect_error(msg);
    }
    if form.password != form.password_confirmation {
        let msg = "Passwords do not match.";
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::Json(json!({"error": msg, "field": "password_confirmation"})),
            )
                .into_response());
        }
        return redirect_error(msg);
    }

    // Check uniqueness
    if User::find_by_username(&state.db, &username)
        .await?
        .is_some()
    {
        let msg = "Username is already taken.";
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::Json(json!({"error": msg, "field": "username"})),
            )
                .into_response());
        }
        return redirect_error(msg);
    }

    // Hash password
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(form.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hash error: {e}")))?
        .to_string();

    User::set_credentials(&state.db, current_user.id, &username, &password_hash).await?;

    if json {
        return Ok(axum::Json(json!({"redirect": "/"})).into_response());
    }
    Ok(Redirect::to("/").into_response())
}

#[derive(Deserialize)]
pub struct RedirectQuery {
    #[serde(default)]
    pub redirect: String,
}

// POST /login
pub async fn login(
    State(state): State<AppState>,
    session: Session,
    headers: axum::http::HeaderMap,
    Query(query): Query<RedirectQuery>,
    Form(form): Form<LoginForm>,
) -> Result<Response, AppError> {
    let json = wants_json(&headers);
    let redirect = query.redirect.clone();
    let redirect_error = |msg: &str| -> Result<Response, AppError> {
        let target = if redirect.is_empty() {
            "/login".to_string()
        } else {
            let query = serde_urlencoded::to_string([("redirect", redirect.as_str())])
                .map_err(|e| AppError::Internal(e.to_string()))?;
            format!("/login?{query}")
        };
        let url = flash_redirect(
            &target,
            FlashMessage {
                message: msg.to_string(),
                severity: FlashSeverity::Error,
            },
        )?;
        Ok(Redirect::to(&url).into_response())
    };

    let login_err = "Invalid username or password.";

    let user = match User::find_by_username(&state.db, form.username.trim()).await? {
        Some(p) => p,
        None => {
            if json {
                return Ok((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    axum::Json(json!({"error": login_err})),
                )
                    .into_response());
            }
            return redirect_error(login_err);
        }
    };

    let stored_hash = match &user.password_hash {
        Some(h) => h.clone(),
        None => {
            if json {
                return Ok((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    axum::Json(json!({"error": login_err})),
                )
                    .into_response());
            }
            return redirect_error(login_err);
        }
    };

    let parsed_hash = PasswordHash::new(&stored_hash)
        .map_err(|e| AppError::Internal(format!("Password hash parse error: {e}")))?;

    if Argon2::default()
        .verify_password(form.password.as_bytes(), &parsed_hash)
        .is_err()
    {
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::Json(json!({"error": login_err})),
            )
                .into_response());
        }
        return redirect_error(login_err);
    }

    // Save the current anonymous token in a cookie so we can restore it on logout
    let anon_token = session.get::<String>(USER_ID_KEY).await.ok().flatten();

    // Switch session to this user's token
    let token = user
        .session_token
        .as_ref()
        .ok_or_else(|| AppError::Internal("Registered user has no session token".to_string()))?;
    session
        .insert(USER_ID_KEY, token.clone())
        .await
        .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;

    let target = if query.redirect.is_empty() {
        "/"
    } else {
        &query.redirect
    };
    let mut response = if json {
        axum::Json(json!({"redirect": target})).into_response()
    } else {
        Redirect::to(target).into_response()
    };
    if let Some(token) = anon_token {
        response.headers_mut().insert(
            axum::http::header::SET_COOKIE,
            format!("{ANON_USER_TOKEN_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax")
                .parse()
                .unwrap(),
        );
    }
    Ok(response)
}

// POST /logout
pub async fn logout(
    session: Session,
    headers: axum::http::HeaderMap,
) -> Result<Response, AppError> {
    let anon_token = get_cookie(&headers, ANON_USER_TOKEN_COOKIE);

    session
        .flush()
        .await
        .map_err(|e| AppError::Internal(format!("Session flush error: {e}")))?;

    // Restore the anonymous identity saved at login
    if let Some(token) = &anon_token {
        session
            .insert(USER_ID_KEY, token.clone())
            .await
            .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;
    }

    let json = wants_json(&headers);
    let redirect = referer_path(&headers);
    let target = if redirect.is_empty() { "/" } else { &redirect };
    let mut response = if json {
        axum::Json(json!({"redirect": target})).into_response()
    } else {
        Redirect::to(target).into_response()
    };
    // Clear the anon cookie regardless
    response.headers_mut().insert(
        axum::http::header::SET_COOKIE,
        format!("{ANON_USER_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
            .parse()
            .unwrap(),
    );
    Ok(response)
}
