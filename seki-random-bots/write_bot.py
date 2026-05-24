import pathlib

content = r"""use std::collections::HashMap;

use go_engine::{GameState, Stone};
use rand::Rng;
use seki_api_types::ws::{ClientMsg, LiveGameItem, ServerMsg};
use serde_json::Value;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::action::{
    GameAction, pick_game_action, pick_random_move, random_chat_message, random_create_game_body,
};
use crate::config::Config;

fn bot_username(bot_index: u32) -> String {
    format!(random-bot-{bot_index})
}

fn my_stone(g: &LiveGameItem, uid: i64) -> Option