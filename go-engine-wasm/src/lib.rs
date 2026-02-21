use std::collections::{HashMap, HashSet};

use go_engine::game_tree::NodeId;
use go_engine::sgf::convert::MoveTime;
use go_engine::{GameTree, Point, Replay, Stone};
use wasm_bindgen::prelude::*;

/// Parse SGF text and return metadata as JSON.
/// Returns JSON: `{ cols, rows, komi?, handicap?, black_name?, ... }`
/// On parse error: `{ "error": "message" }`
#[wasm_bindgen]
pub fn parse_sgf(sgf_text: &str) -> String {
    let collection = match go_engine::sgf::parse(sgf_text) {
        Ok(c) => c,
        Err(e) => return format!(r#"{{"error":"{}"}}"#, e),
    };
    let Some(first) = collection.first() else {
        return r#"{"error":"empty SGF collection"}"#.to_string();
    };
    let conv = go_engine::sgf::convert::sgf_to_game_tree(first);
    serde_json::to_string(&conv.metadata).unwrap_or_else(|e| format!(r#"{{"error":"{}"}}"#, e))
}

#[wasm_bindgen]
pub struct WasmEngine {
    inner: Replay,
    move_times: HashMap<NodeId, MoveTime>,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(cols: u8, rows: u8) -> Self {
        Self {
            inner: Replay::new(cols, rows),
            move_times: HashMap::new(),
        }
    }

    pub fn set_handicap(&mut self, handicap: u8) {
        self.inner.set_handicap(handicap);
    }

    // -- Game actions (delegate to Replay) --

    pub fn try_play(&mut self, col: u8, row: u8) -> bool {
        self.inner.try_play(col, row)
    }

    pub fn pass(&mut self) -> bool {
        self.inner.pass()
    }

    pub fn undo(&mut self) -> bool {
        self.inner.undo()
    }

    // -- Navigation (delegate to Replay) --

    pub fn back(&mut self) -> bool {
        self.inner.back()
    }

    pub fn forward(&mut self) -> bool {
        self.inner.forward()
    }

    pub fn to_start(&mut self) {
        self.inner.to_start();
    }

    pub fn to_latest(&mut self) {
        self.inner.to_latest();
    }

    pub fn view_index(&self) -> usize {
        self.inner.view_index()
    }

    pub fn total_moves(&self) -> usize {
        self.inner.total_moves()
    }

    pub fn is_at_latest(&self) -> bool {
        self.inner.is_at_latest()
    }

    pub fn is_at_start(&self) -> bool {
        self.inner.is_at_start()
    }

    // -- JSON serialization (WASM boundary) --

    pub fn moves_json(&self) -> String {
        serde_json::to_string(&self.inner.moves()).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn replace_moves(&mut self, json: &str) -> bool {
        match serde_json::from_str(json) {
            Ok(moves) => {
                self.inner.replace_moves(moves);
                true
            }
            Err(_) => false,
        }
    }

    // -- Tree API --

    pub fn navigate_to(&mut self, node_id: usize) {
        self.inner.navigate_to(node_id);
    }

    pub fn current_node_id(&self) -> i32 {
        match self.inner.current_node() {
            Some(id) => id as i32,
            None => -1,
        }
    }

    pub fn tree_node_count(&self) -> usize {
        self.inner.tree().len()
    }

    pub fn tree_json(&self) -> String {
        serde_json::to_string(self.inner.tree())
            .unwrap_or_else(|_| r#"{"nodes":[],"root_children":[]}"#.to_string())
    }

    pub fn replace_tree(&mut self, json: &str) -> bool {
        match serde_json::from_str::<GameTree>(json) {
            Ok(tree) => {
                self.inner.replace_tree(tree);
                true
            }
            Err(_) => false,
        }
    }

    // -- SGF import/export --

    /// Load an SGF tree into the current engine, replacing the existing tree.
    /// Returns true on success, false on parse error.
    pub fn load_sgf_tree(&mut self, sgf_text: &str) -> bool {
        let collection = match go_engine::sgf::parse(sgf_text) {
            Ok(c) => c,
            Err(_) => return false,
        };
        let Some(first) = collection.first() else {
            return false;
        };
        let conv = go_engine::sgf::convert::sgf_to_game_tree(first);
        self.move_times = conv.move_times;
        self.inner.replace_tree(conv.tree);
        true
    }

    /// Parse an SGF and load only the move_times map, without touching the tree.
    /// Use this to restore move_times after the tree has been loaded from localStorage.
    pub fn load_sgf_move_times(&mut self, sgf_text: &str) -> bool {
        let collection = match go_engine::sgf::parse(sgf_text) {
            Ok(c) => c,
            Err(_) => return false,
        };
        let Some(first) = collection.first() else {
            return false;
        };
        let conv = go_engine::sgf::convert::sgf_to_game_tree(first);
        self.move_times = conv.move_times;
        true
    }

    /// Return per-move time data for the current node as JSON, or empty string.
    pub fn current_move_time(&self) -> String {
        let Some(node_id) = self.inner.current_node() else {
            return String::new();
        };
        match self.move_times.get(&node_id) {
            Some(mt) => serde_json::to_string(mt).unwrap_or_default(),
            None => String::new(),
        }
    }

    /// Export the current tree as an SGF string.
    /// `meta_json` should be a JSON string with SgfMetadata fields.
    pub fn export_sgf(&self, meta_json: &str) -> String {
        let meta: go_engine::sgf::convert::SgfMetadata =
            serde_json::from_str(meta_json).unwrap_or_else(|_| {
                go_engine::sgf::convert::SgfMetadata {
                    cols: self.inner.cols(),
                    rows: self.inner.rows(),
                    ..Default::default()
                }
            });
        go_engine::sgf::convert::game_tree_to_sgf(self.inner.tree(), &meta)
    }

    // -- Engine accessors (WASM-friendly types) --

    pub fn board(&self) -> js_sys::Int8Array {
        js_sys::Int8Array::from(self.inner.engine().board())
    }

    pub fn cols(&self) -> u8 {
        self.inner.engine().cols()
    }

    pub fn rows(&self) -> u8 {
        self.inner.engine().rows()
    }

    pub fn current_turn_stone(&self) -> i8 {
        self.inner.engine().current_turn_stone().to_int()
    }

    pub fn captures_black(&self) -> u32 {
        self.inner.engine().stone_captures(Stone::Black)
    }

    pub fn captures_white(&self) -> u32 {
        self.inner.engine().stone_captures(Stone::White)
    }

    pub fn is_legal(&self, col: u8, row: u8) -> bool {
        let engine = self.inner.engine();
        let stone = engine.current_turn_stone();
        engine.is_legal((col, row), stone)
    }

    pub fn has_ko(&self) -> bool {
        self.inner.engine().ko().is_some()
    }

    pub fn ko_col(&self) -> i8 {
        match self.inner.engine().ko() {
            Some(ko) => ko.pos.0,
            None => -1,
        }
    }

    pub fn ko_row(&self) -> i8 {
        match self.inner.engine().ko() {
            Some(ko) => ko.pos.1,
            None => -1,
        }
    }

    pub fn move_count(&self) -> usize {
        self.inner.engine().moves().len()
    }

    pub fn has_last_move(&self) -> bool {
        self.inner.last_play_pos().is_some()
    }

    pub fn last_move_col(&self) -> i8 {
        self.inner
            .last_play_pos()
            .map(|(col, _)| col as i8)
            .unwrap_or(-1)
    }

    pub fn last_move_row(&self) -> i8 {
        self.inner
            .last_play_pos()
            .map(|(_, row)| row as i8)
            .unwrap_or(-1)
    }

    // -- Territory review --

    pub fn stage(&self) -> String {
        self.inner.engine().stage().to_string()
    }

    /// Returns JSON array of [col, row] pairs for auto-detected dead stones.
    pub fn detect_dead_stones(&self) -> String {
        let dead = go_engine::territory::detect_dead_stones(self.inner.engine().goban());
        let pts: Vec<[u8; 2]> = dead.into_iter().map(|(c, r)| [c, r]).collect();
        serde_json::to_string(&pts).unwrap_or_else(|_| "[]".into())
    }

    /// Toggle the chain at (col, row) in/out of the dead stones set.
    /// Takes and returns JSON arrays of [col, row] pairs.
    pub fn toggle_dead_chain(&self, col: u8, row: u8, dead_stones_json: &str) -> String {
        let mut dead = parse_dead_stones(dead_stones_json);
        go_engine::territory::toggle_dead_chain(
            self.inner.engine().goban(),
            &mut dead,
            (col, row),
        );
        serialize_dead_stones(&dead)
    }

    /// Returns JSON array of ownership values (1=Black, -1=White, 0=neutral).
    pub fn estimate_territory(&self, dead_stones_json: &str) -> String {
        let dead = parse_dead_stones(dead_stones_json);
        let ownership =
            go_engine::territory::estimate_territory(self.inner.engine().goban(), &dead);
        serde_json::to_string(&ownership).unwrap_or_else(|_| "[]".into())
    }

    /// Returns JSON score object:
    /// {"black":{"territory":n,"captures":n},"white":{"territory":n,"captures":n},"result":"B+3.5"}
    pub fn score(&self, dead_stones_json: &str, komi: f64) -> String {
        let dead = parse_dead_stones(dead_stones_json);
        let goban = self.inner.engine().goban();
        let ownership = go_engine::territory::estimate_territory(goban, &dead);
        let gs = go_engine::territory::score(goban, &ownership, &dead, komi);
        let result = gs.result();
        format!(
            r#"{{"black":{{"territory":{},"captures":{}}},"white":{{"territory":{},"captures":{}}},"result":"{}"}}"#,
            gs.black.territory, gs.black.captures,
            gs.white.territory, gs.white.captures,
            result,
        )
    }
}

fn parse_dead_stones(json: &str) -> HashSet<Point> {
    serde_json::from_str::<Vec<[u8; 2]>>(json)
        .unwrap_or_default()
        .into_iter()
        .map(|[c, r]| (c, r))
        .collect()
}

fn serialize_dead_stones(dead: &HashSet<Point>) -> String {
    let pts: Vec<[u8; 2]> = dead.iter().map(|&(c, r)| [c, r]).collect();
    serde_json::to_string(&pts).unwrap_or_else(|_| "[]".into())
}
