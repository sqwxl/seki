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
use std::borrow::Cow;
use tower_sessions::Session;

use crate::AppState;
use crate::error::AppError;
use crate::models::app_credential::AppCredential;
use crate::models::rating::RatingProfile;
use crate::models::user::{User, normalize_email};
use crate::routes::flash::{
    FlashSeverity, redirect_with_flash, redirect_with_flash_severity, wants_json,
};
use crate::session::{ANON_USER_TOKEN_COOKIE, CurrentUser, OptionalCurrentUser, USER_ID_KEY};
use crate::views::user_data_from_user_with_rank;

pub const PASSWORD_MIN_LENGTH: usize = 8;

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
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub is_bot: Option<String>,
}

// POST /register
pub async fn register(
    State(state): State<AppState>,
    session: Session,
    current_user: CurrentUser,
    headers: axum::http::HeaderMap,
    Query(query): Query<RedirectQuery>,
    Form(form): Form<RegisterForm>,
) -> Result<Response, AppError> {
    if current_user.is_registered() {
        return Ok(Redirect::to("/").into_response());
    }

    let username = form.username.trim().to_string();
    let json = wants_json(&headers);

    // Validate
    // TODO: Statically infer max username length from DB constraint at build time
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

    // TODO: Same as previous comment
    if form.password.len() < PASSWORD_MIN_LENGTH {
        let msg = format!("Password must be at least {PASSWORD_MIN_LENGTH} characters.");
        if json {
            return Ok((
                StatusCode::UNPROCESSABLE_ENTITY,
                axum::Json(json!({"error": msg, "field": "password"})),
            )
                .into_response());
        }
        return redirect_with_flash(&session, "/register", &msg).await;
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

    // Check uniqueness. The current anonymous row already owns its generated
    // username, so keeping that name during upgrade is allowed.
    if User::find_by_username(&state.db, &username)
        .await?
        .is_some_and(|user| user.id != current_user.id)
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

    let email = form
        .email
        .as_deref()
        .map(normalize_email)
        .filter(|e| !e.is_empty());
    if let Some(email) = email.as_deref() {
        if email.parse::<lettre::Address>().is_err() {
            let msg = "Please enter a valid email address.";
            if json {
                return Ok((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    axum::Json(json!({"error": msg, "field": "email"})),
                )
                    .into_response());
            }
            return redirect_with_flash(&session, "/register", msg).await;
        }
        if let Some(existing) = User::find_by_email(&state.db, email).await?
            && existing.id != current_user.id
        {
            let msg = "This email is already in use.";
            if json {
                return Ok((
                    StatusCode::UNPROCESSABLE_ENTITY,
                    axum::Json(json!({"error": msg, "field": "email"})),
                )
                    .into_response());
            }
            return redirect_with_flash(&session, "/register", msg).await;
        }
    }

    let is_bot = form.is_bot.as_deref() == Some("true");

    // The pre-registration username; the profile redirect must not point at
    // it after the rename.
    let previous_username = current_user.username.clone();

    // Hash password
    let salt = SaltString::generate(&mut OsRng);
    let password_hash = Argon2::default()
        .hash_password(form.password.as_bytes(), &salt)
        .map_err(|e| AppError::Internal(format!("Password hash error: {e}")))?
        .to_string();

    if let Err(e) = User::set_credentials(
        &state.db,
        current_user.id,
        &username,
        &password_hash,
        is_bot,
    )
    .await
    {
        if let sqlx::Error::Database(db_error) = &e
            && db_error.is_unique_violation()
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

        return Err(e.into());
    }

    // Ensure rating profile exists for the newly registered user
    crate::models::rating::RatingProfile::get_or_create(&state.db, current_user.id).await?;

    if let Some(email) = email {
        // The email is pended and confirmed via a link rather than trusted
        // on registration.
        let base_url = std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into());
        crate::services::email_confirmation::request(
            &state.db,
            &state.mailer,
            current_user.id,
            &email,
            &base_url,
        )
        .await?;
    }

    let target = if query.redirect.is_empty() {
        "/"
    } else {
        &query.redirect
    };
    // The invitee may have registered from their anonymous profile page;
    // that username no longer exists after the rename, so point the redirect
    // at the fresh profile instead.
    let target = if target == format!("/users/{previous_username}") {
        Cow::Owned(format!("/users/{username}"))
    } else {
        Cow::Borrowed(target)
    };
    if json {
        return Ok(axum::Json(json!({"redirect": target})).into_response());
    }
    Ok(Redirect::to(&target).into_response())
}

#[derive(Deserialize)]
pub struct RedirectQuery {
    #[serde(default)]
    pub redirect: String,
}

#[derive(Deserialize)]
pub struct LoginForm {
    pub username: String,
    pub password: String,
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

    // Save the current anonymous user id in a cookie so we can restore it on logout
    let anon_user_id = session.get::<i64>(USER_ID_KEY).await.ok().flatten();

    // Switch the session to this user.
    session
        .insert(USER_ID_KEY, user.id)
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

    if let Some(user_id) = anon_user_id {
        response.headers_mut().insert(
            axum::http::header::SET_COOKIE,
            format!("{ANON_USER_TOKEN_COOKIE}={user_id}; Path=/; HttpOnly; SameSite=Lax")
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
    if let Some(token) = &anon_token
        && let Ok(user_id) = token.parse::<i64>()
    {
        session
            .insert(USER_ID_KEY, user_id)
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

// GET /api/auth/token — issue a browser app credential (opaque token)
pub async fn issue_token(
    State(state): State<AppState>,
    current_user: CurrentUser,
) -> Result<Json<serde_json::Value>, AppError> {
    let token = crate::services::tokens::generate_token();
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(90)).to_rfc3339();

    AppCredential::create(
        &state.db,
        current_user.id,
        &crate::services::tokens::sha256_hex(&token),
        &expires_at,
    )
    .await
    .map_err(AppError::Database)?;

    let rating_profile = if current_user.is_registered() {
        RatingProfile::find(&state.db, current_user.id).await?
    } else {
        None
    };
    let user_data = user_data_from_user_with_rank(&current_user.user, rating_profile.as_ref());

    Ok(Json(json!({
        "token": token,
        "expires_at": expires_at,
        "user": user_data,
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

    let credential = AppCredential::find_by_token_hash(
        &state.db,
        &crate::services::tokens::sha256_hex(auth_header),
    )
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::Unauthorized("Invalid or expired credential".into()))?;

    if credential.revoked {
        return Err(AppError::Unauthorized("Credential has been revoked".into()));
    }

    let expires_at = chrono::DateTime::parse_from_rfc3339(&credential.expires_at)
        .map_err(|_| AppError::Unauthorized("Invalid credential expiry".into()))?
        .with_timezone(&chrono::Utc);
    if expires_at <= chrono::Utc::now() {
        return Err(AppError::Unauthorized("Credential has expired".into()));
    }

    let user = User::find_by_id(&state.db, credential.user_id)
        .await
        .map_err(AppError::Database)?;

    // Rotate: revoke the old credential, issue a fresh opaque one.
    AppCredential::revoke(&state.db, credential.id)
        .await
        .map_err(AppError::Database)?;

    let new_token = crate::services::tokens::generate_token();
    let expires_at = (chrono::Utc::now() + chrono::Duration::days(90)).to_rfc3339();
    AppCredential::create(
        &state.db,
        user.id,
        &crate::services::tokens::sha256_hex(&new_token),
        &expires_at,
    )
    .await
    .map_err(AppError::Database)?;

    // Establish session
    session
        .insert(USER_ID_KEY, user.id)
        .await
        .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;

    let rating_profile = if user.is_registered() {
        RatingProfile::find(&state.db, user.id).await?
    } else {
        None
    };

    let user_data = user_data_from_user_with_rank(&user, rating_profile.as_ref());

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

    if let Some(credential) = AppCredential::find_by_token_hash(
        &state.db,
        &crate::services::tokens::sha256_hex(auth_header),
    )
    .await
    .map_err(AppError::Database)?
    {
        AppCredential::revoke(&state.db, credential.id)
            .await
            .map_err(AppError::Database)?;
    }

    Ok(Json(json!({"ok": true})))
}

// --- Password reset ---

#[derive(Deserialize)]
pub struct RequestResetForm {
    pub email: String,
}

#[derive(Deserialize)]
pub struct ResetPasswordForm {
    pub token: String,
    pub password: String,
    pub password_confirmation: String,
}

#[derive(Deserialize)]
pub struct ResetTokenQuery {
    pub token: String,
}

// POST /reset-password/request
pub async fn request_reset(
    State(state): State<AppState>,
    session: Session,
    headers: axum::http::HeaderMap,
    Form(form): Form<RequestResetForm>,
) -> Result<Response, AppError> {
    let email = form.email.trim().to_string();
    let base_url = std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into());

    crate::services::password_reset::request_reset(&state.db, &state.mailer, &email, &base_url)
        .await?;

    // Never reveal whether the email has an account.
    let msg = "If an account exists with that email, a reset link has been sent.";
    if wants_json(&headers) {
        return Ok(Json(json!({ "message": msg })).into_response());
    }
    redirect_with_flash_severity(&session, "/reset-password", msg, FlashSeverity::Success).await
}

// GET /api/web/password-reset?token=... — validates a token without consuming it.
pub async fn reset_token_info(
    State(state): State<AppState>,
    Query(query): Query<ResetTokenQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let user = crate::services::password_reset::token_info(&state.db, &query.token).await?;
    match user {
        Some(user) => Ok(Json(json!({ "valid": true, "username": user.username }))),
        None => Ok(Json(json!({ "valid": false }))),
    }
}

// POST /reset-password
pub async fn reset_password(
    State(state): State<AppState>,
    session: Session,
    current_user: OptionalCurrentUser,
    Form(form): Form<ResetPasswordForm>,
) -> Result<Response, AppError> {
    if form.password.len() < PASSWORD_MIN_LENGTH {
        return redirect_with_flash(
            &session,
            &format!("/reset-password?token={}", form.token),
            &format!("Password must be at least {PASSWORD_MIN_LENGTH} characters."),
        )
        .await;
    }
    if form.password != form.password_confirmation {
        return redirect_with_flash(
            &session,
            &format!("/reset-password?token={}", form.token),
            "Passwords do not match.",
        )
        .await;
    }

    let Some(user) =
        crate::services::password_reset::reset_password(&state.db, &form.token, &form.password)
            .await?
    else {
        let msg = "This reset link is invalid or has expired. Please request a new one.";
        return redirect_with_flash(&session, "/reset-password", msg).await;
    };

    // Auto-login on anonymous sessions; a session logged in as a different
    // registered user is left alone.
    let should_login = match current_user.user.as_ref() {
        None => true,
        Some(u) => !u.is_registered() || u.id == user.id,
    };
    if should_login {
        session
            .insert(USER_ID_KEY, user.id)
            .await
            .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;
        return redirect_with_flash_severity(
            &session,
            "/",
            "Password updated. You're logged in.",
            FlashSeverity::Success,
        )
        .await;
    }

    redirect_with_flash_severity(
        &session,
        "/login",
        "Password updated. Please log in.",
        FlashSeverity::Success,
    )
    .await
}
