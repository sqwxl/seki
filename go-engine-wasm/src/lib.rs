use go_engine::{GameTree, Replay, Stone};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmEngine {
    inner: Replay,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(cols: u8, rows: u8) -> Self {
        Self {
            inner: Replay::new(cols, rows),
        }
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
}
