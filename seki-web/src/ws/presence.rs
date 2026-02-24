use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;
use tokio::task::JoinHandle;

/// Default grace period before triggering disconnect logic.
const DEFAULT_GRACE_PERIOD: Duration = Duration::from_secs(5);

/// Per-user connection tracking with grace-period disconnect.
///
/// Each WS connection increments the user's count. When count drops to zero,
/// a timer starts. If no new connection arrives before the timer fires,
/// the disconnect callback runs.
#[derive(Debug, Clone)]
pub struct UserPresence {
    inner: Arc<RwLock<PresenceInner>>,
    grace_period: Duration,
}

#[derive(Debug, Default)]
struct PresenceInner {
    /// user_id -> number of active WS connections
    connections: HashMap<i64, usize>,
    /// user_id -> pending disconnect timer handle
    timers: HashMap<i64, JoinHandle<()>>,
}

impl UserPresence {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(PresenceInner::default())),
            grace_period: DEFAULT_GRACE_PERIOD,
        }
    }

    /// Create with a custom grace period (useful for tests).
    pub fn with_grace_period(grace_period: Duration) -> Self {
        Self {
            inner: Arc::new(RwLock::new(PresenceInner::default())),
            grace_period,
        }
    }

    /// Register a new WS connection for a user.
    /// Returns `true` if the user was previously marked as disconnected
    /// (i.e. had zero connections and a pending timer was cancelled).
    pub async fn connect(&self, user_id: i64) -> bool {
        let mut inner = self.inner.write().await;
        let count = inner.connections.entry(user_id).or_insert(0);
        *count += 1;

        // Cancel pending disconnect timer if any
        if let Some(handle) = inner.timers.remove(&user_id) {
            handle.abort();
            // Timer was pending -> user was "disconnected" (grace period running)
            return true;
        }

        false
    }

    /// Unregister a WS connection for a user.
    /// If count drops to zero, starts a grace-period timer that calls `callback`
    /// if no reconnection happens in time.
    pub async fn disconnect<F>(&self, user_id: i64, callback: F)
    where
        F: FnOnce(i64) + Send + 'static,
    {
        let mut inner = self.inner.write().await;
        if let Some(count) = inner.connections.get_mut(&user_id) {
            *count = count.saturating_sub(1);
            if *count == 0 {
                inner.connections.remove(&user_id);

                // Start grace period timer
                let presence = self.inner.clone();
                let grace = self.grace_period;
                let handle = tokio::spawn(async move {
                    tokio::time::sleep(grace).await;
                    // After grace period, check if still disconnected
                    let mut inner = presence.write().await;
                    // Remove our own timer entry
                    inner.timers.remove(&user_id);
                    // Only fire callback if user is still at zero connections
                    if !inner.connections.contains_key(&user_id) {
                        drop(inner); // release lock before callback
                        callback(user_id);
                    }
                });
                inner.timers.insert(user_id, handle);
            }
        }
    }

    /// Check if a user currently has at least one active connection.
    pub async fn is_connected(&self, user_id: i64) -> bool {
        let inner = self.inner.read().await;
        inner
            .connections
            .get(&user_id)
            .is_some_and(|count| *count > 0)
    }
}
