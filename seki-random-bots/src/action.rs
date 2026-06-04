use go_engine::{Goban, Stone};
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

pub fn pick_random_move(rng: &mut impl Rng, goban: &Goban, stone: Stone) -> Option<(u8, u8)> {
    let cols = goban.cols();
    let rows = goban.rows();
    let total = cols as usize * rows as usize;

    // Collect all positions that are empty AND legal
    let legal: Vec<u8> = (0..total)
        .filter(|&idx| {
            let col = (idx % cols as usize) as u8;
            let row = (idx / cols as usize) as u8;
            goban.is_legal_move((col, row), stone)
        })
        .map(|i| i as u8)
        .collect();

    if legal.is_empty() {
        return None;
    }

    let idx = legal[rng.random_range(0..legal.len())] as usize;
    let col = (idx % cols as usize) as u8;
    let row = (idx / cols as usize) as u8;
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
