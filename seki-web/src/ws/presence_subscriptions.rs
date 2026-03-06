use std::collections::HashMap;
use std::sync::Arc;

use serde_json::json;
use tokio::sync::RwLock;

use super::registry::WsSender;

#[derive(Debug, Clone)]
pub struct PresenceSubscriptions {
    inner: Arc<RwLock<HashMap<i64, Vec<WsSender>>>>,
}

impl Default for PresenceSubscriptions {
    fn default() -> Self {
        Self::new()
    }
}

impl PresenceSubscriptions {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Add a sender to the subscription list for the given user ID.
    pub async fn subscribe(&self, user_id: i64, sender: WsSender) {
        let mut map = self.inner.write().await;
        map.entry(user_id).or_default().push(sender);
    }

    /// Notify all subscribers of a user's presence change.
    pub async fn notify(&self, user_id: i64, online: bool) {
        let msg = Arc::new(
            json!({
                "kind": "presence_changed",
                "user_id": user_id,
                "online": online,
            })
            .to_string(),
        );
        let map = self.inner.read().await;
        if let Some(senders) = map.get(&user_id) {
            for sender in senders {
                let _ = sender.send(Arc::clone(&msg));
            }
        }
    }

    /// Remove a sender from all subscription lists (called on WS close).
    pub async fn remove_sender(&self, sender: &WsSender) {
        let mut map = self.inner.write().await;
        map.retain(|_, senders| {
            senders.retain(|s| !s.same_channel(sender));
            !senders.is_empty()
        });
    }
}

/// Build a presence_state message for a batch of user statuses.
pub fn build_presence_state_msg(statuses: &[(i64, bool)]) -> String {
    let users: serde_json::Map<String, serde_json::Value> = statuses
        .iter()
        .map(|(id, online)| (id.to_string(), json!(*online)))
        .collect();
    json!({
        "kind": "presence_state",
        "users": users,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn subscribe_and_notify() {
        let subs = PresenceSubscriptions::new();
        let (tx, mut rx) = mpsc::unbounded_channel();

        subs.subscribe(42, tx).await;
        subs.notify(42, true).await;

        let msg = rx.recv().await.expect("should receive a message");
        let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(parsed["kind"], "presence_changed");
        assert_eq!(parsed["user_id"], 42);
        assert_eq!(parsed["online"], true);
    }

    #[tokio::test]
    async fn no_notification_without_subscription() {
        let subs = PresenceSubscriptions::new();
        let (tx, mut rx) = mpsc::unbounded_channel();

        subs.subscribe(42, tx).await;
        subs.notify(99, true).await;

        // Nothing should be received
        assert!(rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn remove_sender_cleans_up() {
        let subs = PresenceSubscriptions::new();
        let (tx, _rx) = mpsc::unbounded_channel();

        subs.subscribe(42, tx.clone()).await;
        subs.subscribe(43, tx.clone()).await;

        subs.remove_sender(&tx).await;

        let map = subs.inner.read().await;
        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn build_presence_state_msg_format() {
        let msg = build_presence_state_msg(&[(1, true), (2, false)]);
        let parsed: serde_json::Value = serde_json::from_str(&msg).unwrap();
        assert_eq!(parsed["kind"], "presence_state");
        assert_eq!(parsed["users"]["1"], true);
        assert_eq!(parsed["users"]["2"], false);
    }
}
