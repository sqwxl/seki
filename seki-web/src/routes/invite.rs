use axum::extract::{Path, State};
use axum::response::{IntoResponse, Redirect, Response};
use tower_sessions::Session;

use crate::AppState;
use crate::error::AppError;
use crate::models::game::Game;
use crate::models::user::User;
use crate::routes::flash::redirect_with_flash;
use crate::services::challenge_invites;
use crate::session::{OptionalCurrentUser, USER_ID_KEY};

/// Handles the single-use login link emailed to an invited opponent.
///
/// The token resolves to the challengee (their identity was fixed at mint
/// time). Depending on the visitor's current session this either:
///   - logs an anonymous visitor into the challengee's session (once),
///   - sends a logged-out visitor to /login (registered challengee),
///   - redirects a matching session straight to the game, or
///   - refuses with a flash when the session holds another account's state.
pub async fn accept(
    State(state): State<AppState>,
    session: Session,
    optional_user: OptionalCurrentUser,
    Path(token): Path<String>,
) -> Result<Response, AppError> {
    let Some((row_id, game_id, user_id)) = challenge_invites::resolve(&state.db, &token).await?
    else {
        return redirect_with_flash(&session, "/", "This invite link is invalid or has expired.")
            .await;
    };

    let game = Game::find_by_id(&state.db, game_id).await?;
    let challengee = User::find_by_id(&state.db, user_id).await?;
    let game_url = format!("/games/{game_id}");

    if challengee.is_registered() {
        // The seat belongs to a registered account; the only way in is
        // signing in as that account (no auto-login for registered users).
        if let Some(current) = optional_user.user.as_ref()
            && current.id == challengee.id
        {
            challenge_invites::consume(&state.db, row_id).await?;
            confirm_invite_email(&state, challengee.id).await;
            return Ok(Redirect::to(&game_url).into_response());
        }
        return Ok(Redirect::to(&format!("/login?redirect={game_url}")).into_response());
    }

    // Non-participants can't view private games, so land them somewhere useful.
    let home = if game.is_private {
        "/".to_string()
    } else {
        game_url.clone()
    };

    // Anonymous challengee: only pristine sessions are logged into it.
    if let Some(current) = optional_user.user.as_ref() {
        if current.id == challengee.id {
            // Already the invited player — the token's job is done.
            challenge_invites::consume(&state.db, row_id).await?;
            confirm_invite_email(&state, challengee.id).await;
            return Ok(Redirect::to(&game_url).into_response());
        }
        if !is_pristine_anon(&state, current).await? {
            // Anonymous user with history — swapping would destroy their
            // identity, so refuse and explain.
            return redirect_with_flash(
                &session,
                &home,
                "This invite is for another account. Sign in or register to accept it.",
            )
            .await;
        }
        // Pristine anonymous session falls through to the login swap.
    }

    // Anonymous challengee: bind the visitor's session to them, once.
    let session_token = User::ensure_session_token(&state.db, challengee.id).await?;
    session
        .insert(USER_ID_KEY, session_token)
        .await
        .map_err(|e| AppError::Internal(format!("Session insert error: {e}")))?;
    challenge_invites::consume(&state.db, row_id).await?;
    confirm_invite_email(&state, challengee.id).await;

    Ok(Redirect::to(&game_url).into_response())
}

/// Joining via the invite confirms the invite email the creator supplied
/// (the inviter vouched for it). Conflicts — another account confirmed the
/// address first — are logged and ignored.
async fn confirm_invite_email(state: &AppState, user_id: i64) {
    match User::confirm_pending_email(&state.db, user_id).await {
        Ok(_) => {}
        Err(e) => tracing::warn!("Failed to confirm invite email for user {user_id}: {e}"),
    }
}

/// An anonymous user with no account state worth losing — safe to swap away from.
async fn is_pristine_anon(state: &AppState, user: &User) -> Result<bool, AppError> {
    if user.is_registered() || user.email.is_some() {
        return Ok(false);
    }
    let games: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM games WHERE black_id = ? OR white_id = ? OR creator_id = ?",
    )
    .bind(user.id)
    .bind(user.id)
    .bind(user.id)
    .fetch_one(&state.db)
    .await?;
    if games > 0 {
        return Ok(false);
    }
    let messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE user_id = ?")
        .bind(user.id)
        .fetch_one(&state.db)
        .await?;
    Ok(messages == 0)
}
