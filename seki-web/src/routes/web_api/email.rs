use axum::Json;
use axum::extract::State;
use serde::Deserialize;
use serde_json::json;

use crate::AppState;
use crate::error::AppError;
use crate::models::user::User;
use crate::services::email_confirmation;
use crate::session::OptionalCurrentUser;

#[derive(Deserialize)]
pub struct ConfirmEmailRequest {
    pub token: String,
}

// POST /api/web/confirm-email
pub async fn confirm_email(
    State(state): State<AppState>,
    optional_user: OptionalCurrentUser,
    Json(body): Json<ConfirmEmailRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let Some((row_id, token_user_id, email)) =
        email_confirmation::resolve(&state.db, &body.token).await?
    else {
        return Err(AppError::UnprocessableEntity(
            "This confirmation link is invalid or has expired.".to_string(),
        ));
    };

    if optional_user.user.as_ref().map(|u| u.id) != Some(token_user_id) {
        // Deliberately generic — never reveal whose token this was.
        return Err(AppError::Forbidden(
            "This confirmation link doesn't match your current session. \
             Sign in to the account that requested this email confirmation and try again."
                .to_string(),
        ));
    }

    if !email_confirmation::consume(&state.db, row_id).await? {
        return Err(AppError::UnprocessableEntity(
            "This confirmation link is invalid or has expired.".to_string(),
        ));
    }

    // Promote pending → confirmed. The unique index enforces first-wins if
    // another account confirmed the same address meanwhile.
    match User::confirm_pending_email(&state.db, token_user_id).await {
        Ok(_) => Ok(Json(json!({ "ok": true, "email": email }))),
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            Err(AppError::UnprocessableEntity(
                "This email is already in use by another account.".to_string(),
            ))
        }
        // The pending email was cleared after the link was sent.
        Err(sqlx::Error::RowNotFound) => Err(AppError::UnprocessableEntity(
            "This email is no longer pending confirmation.".to_string(),
        )),
        Err(e) => Err(AppError::Database(e)),
    }
}
