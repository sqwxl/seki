use go_engine::GameState;
use rand::Rng;

use crate::config::{GameSettings, Probabilities};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GameAction {
    Play,
    Pass,
    Resign,
    RequestUndo,
    Chat,
}

pub fn pick_game_action(rng: &mut impl Rng, probs: &Probabilities) -> GameAction {
    let total = probs.play_move + probs.pass_turn + probs.resign + probs.request_undo + probs.chat;
    let roll = rng.random::<f64>() * total;
    if roll < probs.play_move {
        GameAction::Play
    } else if roll < probs.play_move + probs.pass_turn {
        GameAction::Pass
    } else if roll < probs.play_move + probs.pass_turn + probs.resign {
        GameAction::Resign
    } else if roll < probs.play_move + probs.pass_turn + probs.resign + probs.request_undo {
        GameAction::RequestUndo
    } else {
        GameAction::Chat
    }
}

pub fn random_create_game_body(rng: &mut impl Rng, settings: &GameSettings) -> serde_json::Value {
    let board = settings.board_sizes[rng.random_range(0..settings.board_sizes.len())];
    let cols = board[0];
    let rows = board[1];
    let is_private = rng.random::<f64>() < settings.private_probability;
    let ranked = rng.random::<f64>() < settings.ranked_probability;

    let tc_pool: Vec<&String> = if ranked {
        settings
            .time_controls
            .iter()
            .filter(|t| t.as_str() != "none")
            .collect()
    } else {
        settings.time_controls.iter().collect()
    };
    let time_control = tc_pool[rng.random_range(0..tc_pool.len())];

    let mut body = serde_json::json!({
        "cols": cols,
        "rows": rows,
        "is_private": is_private,
    });

    if ranked {
        body["ranked"] = serde_json::Value::Bool(true);
    }

    match time_control.as_str() {
        "fischer" => {
            body["time_control"] = serde_json::json!("fischer");
            body["main_time_secs"] = serde_json::json!(
                rng.random_range(settings.main_time_secs_min..=settings.main_time_secs_max)
            );
            body["increment_secs"] = serde_json::json!(rng.random_range(5..=30));
        }
        "byoyomi" => {
            body["time_control"] = serde_json::json!("byoyomi");
            body["main_time_secs"] = serde_json::json!(
                rng.random_range(settings.main_time_secs_min..=settings.main_time_secs_max)
            );
            body["byoyomi_time_secs"] = serde_json::json!(
                rng.random_range(settings.byoyomi_time_secs_min..=settings.byoyomi_time_secs_max,)
            );
            body["byoyomi_periods"] = serde_json::json!(
                rng.random_range(settings.byoyomi_periods_min..=settings.byoyomi_periods_max,)
            );
        }
        _ => {}
    }

    body
}

pub fn pick_random_move(rng: &mut impl Rng, state: &GameState) -> Option<(i32, i32)> {
    let empty_positions: Vec<usize> = state
        .board
        .iter()
        .enumerate()
        .filter(|(_, v)| **v == 0)
        .map(|(i, _)| i)
        .collect();

    if empty_positions.is_empty() {
        return None;
    }

    let idx = empty_positions[rng.random_range(0..empty_positions.len())];
    let col = (idx % state.cols as usize) as i32;
    let row = (idx / state.cols as usize) as i32;
    Some((col, row))
}

pub fn random_chat_message(rng: &mut impl Rng) -> String {
    let messages = [
        "good luck!",
        "nice move",
        "hmm",
        "interesting",
        "let's see",
        "gg",
        "play faster",
        "sorry",
        "oops",
        "well played",
    ];
    messages[rng.random_range(0..messages.len())].to_string()
}
