use argon2::password_hash::SaltString;
use argon2::password_hash::rand_core::OsRng;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::Form;
use axum::Json;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Redirect, Response};
use serde::Deserialize;
use serde_json::json;
use tower_sessions::Session;

use crate::AppState;
use crate::error::AppError;
use crate::models::app_credential::AppCredential;
use crate::models::user::User;
use crate::routes::{FlashMessage, FlashSeverity, set_flash, wants_json};
use crate::services::jwt;
use crate::session::{ANON_USER_TOKEN_COOKIE, CurrentUser, USER_ID_KEY};
use crate::templates::UserData;

async fn redirect_with_flash(
    session: &Session,
    target: &str,
    message: &str,
) -> Result<Response, AppError> {
    set_flash(
        session,
        FlashMessage {
            message: message.to_string(),
            severity: FlashSeverity::Error,
        },
    )
    .await?;
    Ok(Redirect::to(target).into_response())
}

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
    session: Session,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    Form(form): Form<RegisterForm>,
) -> Result<Response, AppError> {
    if current_user.is_registered() {
        return Ok(Redirect::to("/").into_response());
    }

    let username = form.username.trim().to_string();
    let json = wants_json(&headers);

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
        return redirect_with_flash(&session, "/register", msg).await;
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
        return redirect_with_flash(&session, "/register", msg).await;
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
        return redirect_with_flash(&session, "/register", msg).await;
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
        return redirect_with_flash(&session, "/register", msg).await;
    }

    // Hash password
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(form.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hash error: {e}")))?
        .to_string();

    User::set_credentials(&state.db, current_user.id, &username, &password_hash).await?;

    // Ensure rating profile exists for the newly registered user
    crate::models::rating::RatingProfile::get_or_create(&state.db, current_user.id).await?;

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
    let login_target = if redirect.is_empty() {
        "/login".to_string()
    } else {
        let query = serde_urlencoded::to_string([("redirect", redirect.as_str())])
            .map_err(|e| AppError::Internal(e.to_string()))?;
        format!("/login?{query}")
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
            return redirect_with_flash(&session, &login_target, login_err).await;
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
            return redirect_with_flash(&session, &login_target, login_err).await;
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
        return redirect_with_flash(&session, &login_target, login_err).await;
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

// GET /api/auth/token — issue a browser app JWT
pub async fn issue_token(
    State(state): State<AppState>,
    current_user: CurrentUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let token = jwt::issue_app_credential(current_user.id, &state.jwt_secret)
        .map_err(|e| AppError::Internal(format!("JWT issuance error: {e}")))?;

    let claims = jwt::validate_app_credential(&token, &state.jwt_secret)
        .map_err(|e| AppError::Internal(format!("JWT validation error: {e}")))?;

    let expires_at = chrono::DateTime::from_timestamp(claims.exp as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();

    AppCredential::create(&state.db, current_user.id, &claims.jti, &expires_at)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(json!({
        "token": token,
        "expires_at": expires_at,
    })))
}

// GET /api/auth/restore — restore session from JWT
pub async fn restore_session(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    session: Session,
) -> Result<Json<serde_json::Value>, AppError> {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("Missing or invalid Authorization header".into()))?;

    let claims = jwt::validate_app_credential(auth_header, &state.jwt_secret)
        .map_err(|_| AppError::Unauthorized("Invalid or expired credential".into()))?;

    let credential = AppCredential::find_by_jti(&state.db, &claims.jti)
        .await
        .map_err(AppError::Database)?;

    let credential =
        credential.ok_or_else(|| AppError::Unauthorized("Credential not found".into()))?;

    if credential.revoked {
        return Err(AppError::Unauthorized("Credential has been revoked".into()));
    }

    let user_id: i64 = claims
        .sub
        .parse()
        .map_err(|_| AppError::Unauthorized("Invalid credential subject".into()))?;

    if credential.user_id != user_id {
        return Err(AppError::Unauthorized(
            "Credential subject does not match owner".into(),
        ));
    }

    let expires_at = chrono::DateTime::parse_from_rfc3339(&credential.expires_at)
        .map_err(|_| AppError::Unauthorized("Invalid credential expiry".into()))?
        .with_timezone(&chrono::Utc);
    if expires_at <= chrono::Utc::now() {
        return Err(AppError::Unauthorized("Credential has expired".into()));
    }

    let user = User::find_by_id(&state.db, user_id)
        .await
        .map_err(AppError::Database)?;

    // Revoke the old credential
    AppCredential::revoke_jti(&state.db, &claims.jti)
        .await
        .map_err(AppError::Database)?;

    // Issue a fresh JWT
    let new_token = jwt::issue_app_credential(user.id, &state.jwt_secret)
        .map_err(|e| AppError::Internal(format!("JWT issuance error: {e}")))?;

    let new_claims = jwt::validate_app_credential(&new_token, &state.jwt_secret)
        .map_err(|e| AppError::Internal(format!("JWT validation error: {e}")))?;

    let expires_at = chrono::DateTime::from_timestamp(new_claims.exp as i64, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();

    AppCredential::create(&state.db, user.id, &new_claims.jti, &expires_at)
        .await
        .map_err(AppError::Database)?;

    // Establish session
    if let Some(ref session_token) = user.session_token {
        session
            .insert(USER_ID_KEY, session_token.clone())
            .await
            .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;
    }

    let user_data = UserData::from(&user);
    Ok(Json(json!({
        "user": user_data,
        "token": new_token,
    })))
}

// DELETE /api/auth/token — revoke per-device credential
pub async fn revoke_token(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::Unauthorized("Missing or invalid Authorization header".into()))?;

    let claims = jwt::validate_app_credential(auth_header, &state.jwt_secret)
        .map_err(|_| AppError::Unauthorized("Invalid or expired credential".into()))?;

    AppCredential::revoke_jti(&state.db, &claims.jti)
        .await
        .map_err(AppError::Database)?;

    Ok(Json(json!({"ok": true})))
}
