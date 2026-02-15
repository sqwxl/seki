use crate::engine::Engine;
use crate::turn::Turn;
use crate::Point;

/// Engine wrapper with move history and a navigation cursor.
///
/// Maintains a full move list and a `view_index` (0 = empty board, len = latest).
/// The inner `Engine` is always rebuilt to match the current view position.
#[derive(Debug, Clone)]
pub struct Replay {
    cols: u8,
    rows: u8,
    moves: Vec<Turn>,
    view_index: usize,
    engine: Engine,
}

impl Replay {
    pub fn new(cols: u8, rows: u8) -> Self {
        Self {
            cols,
            rows,
            moves: Vec::new(),
            view_index: 0,
            engine: Engine::new(cols, rows),
        }
    }

    pub fn with_moves(cols: u8, rows: u8, moves: Vec<Turn>) -> Self {
        let view_index = moves.len();
        let engine = Engine::with_moves(cols, rows, moves.clone());
        Self {
            cols,
            rows,
            moves,
            view_index,
            engine,
        }
    }

    fn rebuild(&mut self) {
        let moves = self.moves[..self.view_index].to_vec();
        self.engine = Engine::with_moves(self.cols, self.rows, moves);
    }

    // -- Accessors --

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    pub fn moves(&self) -> &[Turn] {
        &self.moves
    }

    pub fn view_index(&self) -> usize {
        self.view_index
    }

    pub fn total_moves(&self) -> usize {
        self.moves.len()
    }

    pub fn is_at_latest(&self) -> bool {
        self.view_index == self.moves.len()
    }

    pub fn is_at_start(&self) -> bool {
        self.view_index == 0
    }

    /// The last move visible at the current view position, if any.
    pub fn last_move(&self) -> Option<&Turn> {
        if self.view_index > 0 {
            Some(&self.moves[self.view_index - 1])
        } else {
            None
        }
    }

    /// The position of the last played stone at the current view, if any.
    pub fn last_play_pos(&self) -> Option<Point> {
        self.last_move()
            .filter(|t| t.is_play())
            .and_then(|t| t.pos)
    }

    // -- Game actions --

    /// Play the current turn's stone at the given point.
    /// Truncates any future moves beyond view_index before playing.
    /// Returns true if the move was legal.
    pub fn try_play(&mut self, col: u8, row: u8) -> bool {
        self.moves.truncate(self.view_index);
        let stone = self.engine.current_turn_stone();
        if self.engine.try_play(stone, (col, row)).is_ok() {
            self.moves.push(Turn::play(stone, (col, row)));
            self.view_index = self.moves.len();
            true
        } else {
            false
        }
    }

    /// Pass the current turn.
    /// Truncates any future moves beyond view_index before passing.
    /// Returns true on success.
    pub fn pass(&mut self) -> bool {
        self.moves.truncate(self.view_index);
        let stone = self.engine.current_turn_stone();
        if self.engine.try_pass(stone).is_ok() {
            self.moves.push(Turn::pass(stone));
            self.view_index = self.moves.len();
            true
        } else {
            false
        }
    }

    /// Undo the last move (removes it from history).
    pub fn undo(&mut self) -> bool {
        if self.moves.is_empty() {
            return false;
        }
        self.moves.pop();
        self.view_index = self.moves.len();
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
        if self.view_index >= self.moves.len() {
            return false;
        }
        self.view_index += 1;
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
        self.view_index = self.moves.len();
        self.rebuild();
    }

    /// Replace the full move history.
    /// Clamps the view_index if it exceeds the new length.
    pub fn replace_moves(&mut self, moves: Vec<Turn>) {
        let new_len = moves.len();
        self.moves = moves;
        if self.view_index > new_len {
            self.view_index = new_len;
        }
        self.rebuild();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Stone;

    #[test]
    fn new_replay_is_at_start_and_latest() {
        let r = Replay::new(9, 9);
        assert!(r.is_at_start());
        assert!(r.is_at_latest());
        assert_eq!(r.total_moves(), 0);
        assert_eq!(r.view_index(), 0);
        assert!(r.last_move().is_none());
    }

    #[test]
    fn play_advances_view() {
        let mut r = Replay::new(9, 9);
        assert!(r.try_play(0, 0));
        assert_eq!(r.total_moves(), 1);
        assert_eq!(r.view_index(), 1);
        assert!(r.is_at_latest());
        assert!(!r.is_at_start());
    }

    #[test]
    fn back_and_forward() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);

        assert!(r.back());
        assert_eq!(r.view_index(), 1);
        assert!(!r.is_at_latest());

        assert!(r.forward());
        assert_eq!(r.view_index(), 2);
        assert!(r.is_at_latest());
    }

    #[test]
    fn back_at_start_returns_false() {
        let mut r = Replay::new(9, 9);
        assert!(!r.back());
    }

    #[test]
    fn forward_at_latest_returns_false() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        assert!(!r.forward());
    }

    #[test]
    fn to_start_and_to_latest() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);

        r.to_start();
        assert!(r.is_at_start());
        assert_eq!(r.view_index(), 0);

        r.to_latest();
        assert!(r.is_at_latest());
        assert_eq!(r.view_index(), 2);
    }

    #[test]
    fn play_truncates_future() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);
        r.back();
        // Play at a different point — should truncate the second move
        assert!(r.try_play(2, 0));
        assert_eq!(r.total_moves(), 2);
        assert!(r.is_at_latest());
    }

    #[test]
    fn undo_removes_last_move() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);
        assert!(r.undo());
        assert_eq!(r.total_moves(), 1);
        assert!(r.is_at_latest());
    }

    #[test]
    fn undo_empty_returns_false() {
        let mut r = Replay::new(9, 9);
        assert!(!r.undo());
    }

    #[test]
    fn replace_moves_clamps_view() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);
        r.try_play(2, 0);
        assert_eq!(r.view_index(), 3);

        // Replace with fewer moves
        let moves = vec![Turn::play(Stone::Black, (0, 0))];
        r.replace_moves(moves);
        assert_eq!(r.total_moves(), 1);
        assert_eq!(r.view_index(), 1);
    }

    #[test]
    fn last_play_pos() {
        let mut r = Replay::new(9, 9);
        assert!(r.last_play_pos().is_none());

        r.try_play(3, 4);
        assert_eq!(r.last_play_pos(), Some((3, 4)));

        r.pass();
        assert!(r.last_play_pos().is_none());
    }

    #[test]
    fn with_moves_constructor() {
        let moves = vec![
            Turn::play(Stone::Black, (0, 0)),
            Turn::play(Stone::White, (1, 0)),
        ];
        let r = Replay::with_moves(9, 9, moves);
        assert_eq!(r.total_moves(), 2);
        assert!(r.is_at_latest());
        assert_eq!(r.engine().current_turn_stone(), Stone::Black);
    }

    #[test]
    fn engine_reflects_view_position() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0); // Black
        r.try_play(1, 0); // White

        r.back();
        // Engine should be at move 1 — white's turn
        assert_eq!(r.engine().current_turn_stone(), Stone::White);
        assert!(r.engine().stone_at((0, 0)).is_some());
        assert!(r.engine().stone_at((1, 0)).is_none());
    }
}
