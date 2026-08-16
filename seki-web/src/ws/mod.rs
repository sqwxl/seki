pub mod game_channel;
pub mod live;
pub mod presence;
pub mod presence_subscriptions;
pub mod registry;
pub mod registry_cleanup;

use seki_api::ws::ServerMsg;

/// Serialize a server WS message to its wire string.
pub fn ws_msg(msg: &ServerMsg) -> String {
    serde_json::to_string(msg).unwrap_or_default()
}
