use go_engine::{Engine, Stone, Turn};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmEngine {
    cols: u8,
    rows: u8,
    all_moves: Vec<Turn>,
    view_index: usize, // 0 = empty board, len = latest
    engine: Engine,     // cached at view_index
}

impl WasmEngine {
    fn rebuild(&mut self) {
        let moves = self.all_moves[..self.view_index].to_vec();
        self.engine = Engine::with_moves(self.cols, self.rows, moves);
    }
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(cols: u8, rows: u8) -> Self {
        Self {
            cols,
            rows,
            all_moves: Vec::new(),
            view_index: 0,
            engine: Engine::new(cols, rows),
        }
    }

    /// Play the current turn's stone at (col, row). Returns true if the move was legal.
    /// Truncates any future moves beyond view_index before playing.
    pub fn try_play(&mut self, col: u8, row: u8) -> bool {
        self.all_moves.truncate(self.view_index);
        let stone = self.engine.current_turn_stone();
        if self.engine.try_play(stone, (col, row)).is_ok() {
            self.all_moves.push(Turn::play(stone, (col, row)));
            self.view_index = self.all_moves.len();
            true
        } else {
            false
        }
    }

    /// Pass the current turn. Returns true on success.
    /// Truncates any future moves beyond view_index before passing.
    pub fn pass(&mut self) -> bool {
        self.all_moves.truncate(self.view_index);
        let stone = self.engine.current_turn_stone();
        if self.engine.try_pass(stone).is_ok() {
            self.all_moves.push(Turn::pass(stone));
            self.view_index = self.all_moves.len();
            true
        } else {
            false
        }
    }

    /// Undo the last move (removes it from history).
    pub fn undo(&mut self) -> bool {
        if self.all_moves.is_empty() {
            return false;
        }
        self.all_moves.pop();
        self.view_index = self.all_moves.len();
        self.rebuild();
        true
    }

    // -- Navigation --

    /// Step back one move. Returns false if already at start.
    pub fn back(&mut self) -> bool {
        if self.view_index == 0 {
            return false;
        }
        self.view_index -= 1;
        self.rebuild();
        true
    }

    /// Step forward one move. Returns false if already at latest.
    pub fn forward(&mut self) -> bool {
        if self.view_index >= self.all_moves.len() {
            return false;
        }
        self.view_index += 1;
        // Optimize: rebuild from scratch (could replay one move, but rebuild is simple and correct)
        self.rebuild();
        true
    }

    /// Jump to the start (empty board).
    pub fn to_start(&mut self) {
        self.view_index = 0;
        self.rebuild();
    }

    /// Jump to the latest move.
    pub fn to_latest(&mut self) {
        self.view_index = self.all_moves.len();
        self.rebuild();
    }

    pub fn view_index(&self) -> usize {
        self.view_index
    }

    pub fn total_moves(&self) -> usize {
        self.all_moves.len()
    }

    pub fn is_at_latest(&self) -> bool {
        self.view_index == self.all_moves.len()
    }

    pub fn is_at_start(&self) -> bool {
        self.view_index == 0
    }

    /// Export all moves as a JSON string.
    pub fn moves_json(&self) -> String {
        serde_json::to_string(&self.all_moves).unwrap_or_else(|_| "[]".to_string())
    }

    // -- Live game support --

    /// Replace the move history from a JSON array of turns.
    /// Format: [{"kind":"play","stone":1,"pos":[col,row]}, {"kind":"pass","stone":-1,"pos":null}, ...]
    /// If the current view_index is still valid, it stays; otherwise clamps to the new length.
    pub fn replace_moves(&mut self, json: &str) -> bool {
        let parsed: Result<Vec<Turn>, _> = serde_json::from_str(json);
        match parsed {
            Ok(moves) => {
                let new_len = moves.len();
                self.all_moves = moves;
                if self.view_index > new_len {
                    self.view_index = new_len;
                }
                self.rebuild();
                true
            }
            Err(_) => false,
        }
    }

    // -- Delegates to cached engine --

    /// Flat board array (row-major, length = cols * rows). 1 = Black, -1 = White, 0 = empty.
    pub fn board(&self) -> js_sys::Int8Array {
        js_sys::Int8Array::from(self.engine.board())
    }

    pub fn cols(&self) -> u8 {
        self.engine.cols()
    }

    pub fn rows(&self) -> u8 {
        self.engine.rows()
    }

    /// 1 = Black's turn, -1 = White's turn.
    pub fn current_turn_stone(&self) -> i8 {
        self.engine.current_turn_stone().to_int()
    }

    pub fn captures_black(&self) -> u32 {
        self.engine.stone_captures(Stone::Black)
    }

    pub fn captures_white(&self) -> u32 {
        self.engine.stone_captures(Stone::White)
    }

    pub fn is_legal(&self, col: u8, row: u8) -> bool {
        let stone = self.engine.current_turn_stone();
        self.engine.is_legal((col, row), stone)
    }

    pub fn has_ko(&self) -> bool {
        self.engine.ko().is_some()
    }

    pub fn ko_col(&self) -> i8 {
        match self.engine.ko() {
            Some(ko) => ko.pos.0 as i8,
            None => -1,
        }
    }

    pub fn ko_row(&self) -> i8 {
        match self.engine.ko() {
            Some(ko) => ko.pos.1 as i8,
            None => -1,
        }
    }

    pub fn move_count(&self) -> usize {
        self.engine.moves().len()
    }
}
