use std::fmt;

use serde::{Deserialize, Serialize};

use crate::Point;
use crate::error::GoError;
use crate::goban::{Captures, Goban};
use crate::handicap;
use crate::ko::Ko;
use crate::stone::Stone;
use crate::turn::Turn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Unstarted,
    BlackToPlay,
    WhiteToPlay,
    TerritoryReview,
    Done,
}

impl Stage {
    pub fn is_play(&self) -> bool {
        matches!(self, Stage::BlackToPlay | Stage::WhiteToPlay)
    }
}

impl fmt::Display for Stage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Stage::Unstarted => write!(f, "unstarted"),
            Stage::BlackToPlay => write!(f, "black_to_play"),
            Stage::WhiteToPlay => write!(f, "white_to_play"),
            Stage::TerritoryReview => write!(f, "territory_review"),
            Stage::Done => write!(f, "done"),
        }
    }
}

impl std::str::FromStr for Stage {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "unstarted" => Ok(Stage::Unstarted),
            "black_to_play" => Ok(Stage::BlackToPlay),
            "white_to_play" => Ok(Stage::WhiteToPlay),
            "territory_review" => Ok(Stage::TerritoryReview),
            "done" => Ok(Stage::Done),
            _ => Err(format!("unknown stage: {s}")),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GameState {
    pub board: Vec<i8>,
    pub cols: u8,
    pub rows: u8,
    pub captures: Captures,
    pub ko: Option<Ko>,
}

#[derive(Debug, Clone)]
pub struct Engine {
    cols: u8,
    rows: u8,
    handicap: u8,
    moves: Vec<Turn>,
    goban: Goban,
    result: Option<String>,
}

impl Engine {
    pub fn new(cols: u8, rows: u8) -> Self {
        Self::create(cols, rows, 0, Vec::new())
    }

    pub fn with_moves(cols: u8, rows: u8, moves: Vec<Turn>) -> Self {
        Self::create(cols, rows, 0, moves)
    }

    pub fn with_handicap(cols: u8, rows: u8, handicap: u8) -> Self {
        Self::create(cols, rows, handicap, Vec::new())
    }

    pub fn with_handicap_and_moves(cols: u8, rows: u8, handicap: u8, moves: Vec<Turn>) -> Self {
        Self::create(cols, rows, handicap, moves)
    }

    fn create(cols: u8, rows: u8, handicap: u8, moves: Vec<Turn>) -> Self {
        let mut goban = Goban::with_dimensions(cols, rows);
        if handicap >= 2 {
            if let Some(pts) = handicap::handicap_points(cols, rows, handicap) {
                for pt in pts {
                    goban.set_stone(pt, Stone::Black);
                }
            }
        }
        let goban = goban.replay_moves(&moves);
        let result = Self::result_from_moves(&moves);
        Engine {
            cols,
            rows,
            handicap,
            moves,
            goban,
            result,
        }
    }

    fn result_from_moves(moves: &[Turn]) -> Option<String> {
        moves.last().and_then(|t| {
            if t.is_resign() {
                Some(format!("{}+R", t.stone.opp()))
            } else {
                None
            }
        })
    }

    // -- Accessors --

    pub fn cols(&self) -> u8 {
        self.cols
    }

    pub fn rows(&self) -> u8 {
        self.rows
    }

    pub fn handicap(&self) -> u8 {
        self.handicap
    }

    pub fn moves(&self) -> &[Turn] {
        &self.moves
    }

    pub fn goban(&self) -> &Goban {
        &self.goban
    }

    pub fn board(&self) -> &[i8] {
        self.goban.board()
    }

    pub fn ko(&self) -> &Option<Ko> {
        self.goban.ko()
    }

    pub fn captures(&self) -> &Captures {
        self.goban.captures()
    }

    pub fn stone_captures(&self, stone: Stone) -> u32 {
        self.goban.captures().get(stone)
    }

    pub fn stone_at(&self, point: Point) -> Option<Stone> {
        self.goban.stone_at(point)
    }

    pub fn current_turn_stone(&self) -> Stone {
        match self.moves.last() {
            None if self.handicap >= 2 => Stone::White,
            None => Stone::Black,
            Some(m) => m.stone.opp(),
        }
    }

    pub fn result(&self) -> Option<&str> {
        self.result.as_deref()
    }

    pub fn set_result(&mut self, result: String) {
        self.result = Some(result);
    }

    // -- Game actions --

    pub fn try_play(&mut self, stone: Stone, point: Point) -> Result<Stage, GoError> {
        if stone != self.current_turn_stone() {
            return Err(GoError::OutOfTurn);
        }

        self.goban = self.goban.play(point, stone)?;
        self.moves.push(Turn::play(stone, point));
        Ok(self.stage())
    }

    pub fn try_pass(&mut self, stone: Stone) -> Result<Stage, GoError> {
        if stone != self.current_turn_stone() {
            return Err(GoError::OutOfTurn);
        }

        self.goban.pass();
        self.moves.push(Turn::pass(stone));
        Ok(self.stage())
    }

    pub fn try_resign(&mut self, stone: Stone) -> Stage {
        if self.result.is_none() {
            self.result = Some(format!("{}+R", stone.opp()));
        }
        self.stage()
    }

    pub fn is_legal(&self, point: Point, stone: Stone) -> bool {
        self.goban.is_legal_move(point, stone)
    }

    pub fn stage(&self) -> Stage {
        if self.moves.is_empty() {
            Stage::Unstarted
        } else if self.result.is_some() {
            Stage::Done
        } else if matches!(
            self.moves.as_slice(),
            [.., a, b] if a.is_pass() && b.is_pass()
        ) {
            Stage::TerritoryReview
        } else {
            match self.current_turn_stone() {
                Stone::Black => Stage::BlackToPlay,
                Stone::White => Stage::WhiteToPlay,
            }
        }
    }

    // -- Serialization --

    pub fn game_state(&self) -> GameState {
        GameState {
            board: self.goban.board().to_vec(),
            cols: self.cols,
            rows: self.rows,
            captures: self.goban.captures().clone(),
            ko: self.goban.ko().clone(),
        }
    }

    pub fn from_game_state(
        cols: u8,
        rows: u8,
        handicap: u8,
        moves: Vec<Turn>,
        state: GameState,
    ) -> Self {
        let goban = Goban::from_state(state);
        let result = Self::result_from_moves(&moves);

        Engine {
            cols,
            rows,
            handicap,
            moves,
            goban,
            result,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn goban_from_layout(layout: &[&str]) -> Goban {
        let board: Vec<Vec<i8>> = layout
            .iter()
            .map(|row| {
                row.chars()
                    .map(|c| match c {
                        'B' => Stone::Black.to_int(),
                        'W' => Stone::White.to_int(),
                        _ => 0,
                    })
                    .collect()
            })
            .collect();
        Goban::new(board)
    }

    fn engine_from_layout(layout: &[&str]) -> Engine {
        let goban = goban_from_layout(layout);
        let cols = layout[0].len() as u8;
        let rows = layout.len() as u8;

        Engine {
            cols,
            rows,
            handicap: 0,
            moves: Vec::new(),
            goban,
            result: None,
        }
    }

    // -- Initialization --

    #[test]
    fn creates_square_board() {
        let engine = Engine::new(4, 4);
        assert_eq!(engine.cols(), 4);
        assert_eq!(engine.rows(), 4);
        assert_eq!(engine.board().len(), 16);
    }

    #[test]
    fn creates_rectangular_board() {
        let engine = Engine::new(5, 3);
        assert_eq!(engine.cols(), 5);
        assert_eq!(engine.rows(), 3);
        assert_eq!(engine.board().len(), 15);
    }

    #[test]
    fn starts_with_empty_board() {
        let engine = Engine::new(4, 4);
        assert!(engine.board().iter().all(|&s| s == 0));
    }

    #[test]
    fn tracks_captures_starting_at_zero() {
        let engine = Engine::new(4, 4);
        assert_eq!(engine.captures().black, 0);
        assert_eq!(engine.captures().white, 0);
    }

    #[test]
    fn initializes_with_moves() {
        let moves = vec![
            Turn::play(Stone::Black, (0, 0)),
            Turn::play(Stone::White, (1, 0)),
        ];
        let engine = Engine::with_moves(4, 4, moves);
        assert_eq!(engine.stone_at((0, 0)), Some(Stone::Black));
        assert_eq!(engine.stone_at((1, 0)), Some(Stone::White));
    }

    // -- Handicap --

    #[test]
    fn handicap_places_stones() {
        let engine = Engine::with_handicap(19, 19, 4);
        assert_eq!(engine.stone_at((3, 3)), Some(Stone::Black));
        assert_eq!(engine.stone_at((15, 3)), Some(Stone::Black));
        assert_eq!(engine.stone_at((3, 15)), Some(Stone::Black));
        assert_eq!(engine.stone_at((15, 15)), Some(Stone::Black));
        assert_eq!(engine.handicap(), 4);
    }

    #[test]
    fn handicap_white_plays_first() {
        let engine = Engine::with_handicap(19, 19, 2);
        assert_eq!(engine.current_turn_stone(), Stone::White);
    }

    #[test]
    fn handicap_stage_is_unstarted() {
        let engine = Engine::with_handicap(19, 19, 2);
        assert_eq!(engine.stage(), Stage::Unstarted);
    }

    #[test]
    fn handicap_with_moves_replays() {
        let moves = vec![Turn::play(Stone::White, (0, 0))];
        let engine = Engine::with_handicap_and_moves(19, 19, 2, moves);
        assert_eq!(engine.stone_at((0, 0)), Some(Stone::White));
        assert_eq!(engine.stone_at((15, 3)), Some(Stone::Black));
        assert_eq!(engine.stone_at((3, 15)), Some(Stone::Black));
        assert_eq!(engine.current_turn_stone(), Stone::Black);
    }

    #[test]
    fn no_handicap_zero() {
        let engine = Engine::with_handicap(19, 19, 0);
        assert!(engine.goban().is_empty());
        assert_eq!(engine.current_turn_stone(), Stone::Black);
    }

    #[test]
    fn handicap_non_19x19_ignored() {
        let engine = Engine::with_handicap(9, 9, 4);
        assert!(engine.goban().is_empty());
    }

    // -- Turn management --

    #[test]
    fn starts_with_black() {
        let engine = Engine::new(4, 4);
        assert_eq!(engine.current_turn_stone(), Stone::Black);
    }

    #[test]
    fn alternates_turns() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        assert_eq!(engine.current_turn_stone(), Stone::White);

        engine.try_play(Stone::White, (1, 0)).unwrap();
        assert_eq!(engine.current_turn_stone(), Stone::Black);
    }

    #[test]
    fn turn_alternates_after_pass() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        engine.try_pass(Stone::White).unwrap();
        assert_eq!(engine.current_turn_stone(), Stone::Black);
    }

    #[test]
    fn prevents_play_out_of_turn() {
        let mut engine = Engine::new(4, 4);
        let result = engine.try_play(Stone::White, (0, 0));
        assert!(matches!(result, Err(GoError::OutOfTurn)));
    }

    #[test]
    fn prevents_pass_out_of_turn() {
        let mut engine = Engine::new(4, 4);
        let result = engine.try_pass(Stone::White);
        assert!(matches!(result, Err(GoError::OutOfTurn)));
    }

    // -- Game stages --

    #[test]
    fn starts_unstarted() {
        let engine = Engine::new(4, 4);
        assert_eq!(engine.stage(), Stage::Unstarted);
    }

    #[test]
    fn play_stage_after_first_move() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        assert_eq!(engine.stage(), Stage::WhiteToPlay);
    }

    #[test]
    fn stays_play_after_single_pass() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        engine.try_pass(Stone::White).unwrap();
        assert!(engine.stage().is_play());
    }

    #[test]
    fn territory_review_after_two_passes() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        engine.try_pass(Stone::White).unwrap();
        engine.try_pass(Stone::Black).unwrap();
        assert_eq!(engine.stage(), Stage::TerritoryReview);
    }

    #[test]
    fn done_after_resign() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        engine.try_resign(Stone::White);
        assert_eq!(engine.stage(), Stage::Done);
    }

    #[test]
    fn returns_to_play_after_pass_then_move() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        engine.try_pass(Stone::White).unwrap();
        engine.try_play(Stone::Black, (1, 0)).unwrap();
        assert!(engine.stage().is_play());
    }

    // -- Move validation --

    #[test]
    fn validates_legal_moves() {
        let engine = Engine::new(4, 4);
        assert!(engine.is_legal((0, 0), Stone::Black));
        assert!(engine.is_legal((3, 3), Stone::Black));
    }

    #[test]
    fn rejects_moves_off_board() {
        let engine = Engine::new(4, 4);
        assert!(!engine.is_legal((4, 0), Stone::Black));
        assert!(!engine.is_legal((0, 4), Stone::Black));
        assert!(!engine.is_legal((255, 0), Stone::Black));
        assert!(!engine.is_legal((0, 255), Stone::Black));
    }

    #[test]
    fn rejects_occupied_points() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        engine.try_play(Stone::White, (1, 0)).unwrap();
        assert!(!engine.is_legal((0, 0), Stone::Black));
        assert!(!engine.is_legal((1, 0), Stone::Black));
    }

    #[test]
    fn rejects_suicidal_moves() {
        let engine = engine_from_layout(&["+B++", "B+B+", "+B++", "++++"]);
        assert!(!engine.is_legal((1, 1), Stone::White));
    }

    // -- Captures tracking --

    #[test]
    fn tracks_captures() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 1)).unwrap();
        engine.try_play(Stone::White, (0, 0)).unwrap();
        engine.try_play(Stone::Black, (1, 0)).unwrap();

        assert_eq!(engine.captures().black, 1);
        assert_eq!(engine.captures().white, 0);
    }

    #[test]
    fn stone_captures_by_color() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 1)).unwrap();
        engine.try_play(Stone::White, (0, 0)).unwrap();
        engine.try_play(Stone::Black, (1, 0)).unwrap();

        assert_eq!(engine.stone_captures(Stone::Black), 1);
        assert_eq!(engine.stone_captures(Stone::White), 0);
    }

    // -- Game state access --

    #[test]
    fn ko_state_default() {
        let engine = Engine::new(4, 4);
        assert!(engine.ko().is_none());
    }

    #[test]
    fn board_access() {
        let engine = Engine::new(4, 4);
        assert_eq!(engine.board(), engine.goban().board());
    }

    #[test]
    fn stone_at_position() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (2, 2)).unwrap();
        assert_eq!(engine.stone_at((2, 2)), Some(Stone::Black));
        assert_eq!(engine.stone_at((0, 0)), None);
    }

    // -- Serialization --

    #[test]
    fn game_state_empty_engine() {
        let engine = Engine::new(4, 4);
        let gs = engine.game_state();

        assert!(gs.ko.is_none());
        assert_eq!(gs.captures.black, 0);
        assert_eq!(gs.captures.white, 0);
        assert_eq!(gs.cols, 4);
        assert_eq!(gs.rows, 4);
        assert_eq!(gs.board.len(), 16);
        assert!(gs.board.iter().all(|&v| v == 0));
    }

    #[test]
    fn game_state_json_shape() {
        let engine = Engine::new(4, 4);
        let gs = engine.game_state();
        let json = serde_json::to_value(&gs).unwrap();

        assert!(json["ko"].is_null());
        assert_eq!(json["captures"]["black"], 0);
        assert_eq!(json["captures"]["white"], 0);
    }

    #[test]
    fn game_state_with_moves_and_captures() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 1)).unwrap();
        engine.try_play(Stone::White, (0, 0)).unwrap();
        engine.try_play(Stone::Black, (1, 0)).unwrap();

        let gs = engine.game_state();

        assert_eq!(gs.captures.black, 1);
        assert_eq!(gs.captures.white, 0);
        // flat index: row * cols + col
        assert_eq!(gs.board[4], Stone::Black.to_int());
        assert_eq!(gs.board[0], 0);
    }

    #[test]
    fn game_state_with_ko() {
        let mut engine = engine_from_layout(&["+BW+", "BW+W", "+BW+", "++++"]);
        engine.try_play(Stone::Black, (2, 1)).unwrap();

        let gs = engine.game_state();
        let ko = gs.ko.as_ref().unwrap();
        assert_eq!(ko.pos, (1, 1));
        assert_eq!(ko.illegal, Stone::White);
    }

    #[test]
    fn game_state_ko_json_shape() {
        let mut engine = engine_from_layout(&["+BW+", "BW+W", "+BW+", "++++"]);
        engine.try_play(Stone::Black, (2, 1)).unwrap();

        let json = serde_json::to_value(engine.game_state()).unwrap();
        assert_eq!(json["ko"]["pos"], serde_json::json!([1, 1]));
        assert_eq!(json["ko"]["illegal"], Stone::White.to_int());
    }

    #[test]
    fn round_trip_empty() {
        let engine = Engine::new(4, 4);
        let gs = engine.game_state();
        let json = serde_json::to_value(&gs).unwrap();
        let restored_gs: GameState = serde_json::from_value(json).unwrap();
        let restored = Engine::from_game_state(4, 4, 0, vec![], restored_gs);

        assert_eq!(restored.cols(), 4);
        assert_eq!(restored.rows(), 4);
        assert_eq!(restored.board(), engine.board());
        assert_eq!(restored.captures(), engine.captures());
        assert!(restored.ko().is_none());
        assert_eq!(restored.stage(), engine.stage());
    }

    #[test]
    fn round_trip_with_moves_and_captures() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 1)).unwrap();
        engine.try_play(Stone::White, (0, 0)).unwrap();
        engine.try_play(Stone::Black, (1, 0)).unwrap();

        let json = serde_json::to_value(engine.game_state()).unwrap();
        let moves = engine.moves().to_vec();
        let restored_gs: GameState = serde_json::from_value(json).unwrap();
        let restored = Engine::from_game_state(4, 4, 0, moves.clone(), restored_gs);

        assert_eq!(restored.board(), engine.board());
        assert_eq!(restored.captures(), engine.captures());
        assert!(restored.ko().is_none());
        assert_eq!(restored.moves().len(), moves.len());
        assert_eq!(restored.stage(), engine.stage());
    }

    #[test]
    fn round_trip_with_ko() {
        let mut engine = engine_from_layout(&["+BW+", "BW+W", "+BW+", "++++"]);
        engine.try_play(Stone::Black, (2, 1)).unwrap();

        let json = serde_json::to_value(engine.game_state()).unwrap();
        let moves = engine.moves().to_vec();
        let restored_gs: GameState = serde_json::from_value(json).unwrap();
        let restored = Engine::from_game_state(4, 4, 0, moves, restored_gs);

        assert_eq!(restored.ko(), engine.ko());
        assert_eq!(restored.board(), engine.board());
        assert_eq!(restored.captures(), engine.captures());
    }

    #[test]
    fn round_trip_rectangular_board() {
        let mut engine = Engine::new(5, 3);
        engine.try_play(Stone::Black, (2, 1)).unwrap();

        let json = serde_json::to_value(engine.game_state()).unwrap();
        let moves = engine.moves().to_vec();
        let restored_gs: GameState = serde_json::from_value(json).unwrap();
        let restored = Engine::from_game_state(5, 3, 0, moves, restored_gs);

        assert_eq!(restored.cols(), 5);
        assert_eq!(restored.rows(), 3);
        assert_eq!(restored.board(), engine.board());
        assert_eq!(restored.stone_at((2, 1)), Some(Stone::Black));
    }

    #[test]
    fn round_trip_serialization() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 0)).unwrap();
        engine.try_play(Stone::White, (1, 1)).unwrap();
        engine.try_play(Stone::Black, (2, 2)).unwrap();
        engine.try_pass(Stone::White).unwrap();

        let json = serde_json::to_value(engine.game_state()).unwrap();
        let moves = engine.moves().to_vec();
        let restored_gs: GameState = serde_json::from_value(json).unwrap();
        let restored = Engine::from_game_state(4, 4, 0, moves.clone(), restored_gs);

        assert_eq!(restored.board(), engine.board());
        assert_eq!(restored.captures(), engine.captures());
        assert_eq!(restored.ko(), engine.ko());
        assert_eq!(restored.stage(), engine.stage());
        assert_eq!(restored.moves().len(), moves.len());
    }

    #[test]
    fn round_trip_with_captures() {
        let mut engine = Engine::new(4, 4);
        engine.try_play(Stone::Black, (0, 1)).unwrap();
        engine.try_play(Stone::White, (0, 0)).unwrap();
        engine.try_play(Stone::Black, (1, 0)).unwrap();
        engine.try_play(Stone::White, (2, 0)).unwrap();
        engine.try_play(Stone::Black, (3, 0)).unwrap();
        engine.try_play(Stone::White, (3, 1)).unwrap();

        let json = serde_json::to_value(engine.game_state()).unwrap();
        let moves = engine.moves().to_vec();
        let restored_gs: GameState = serde_json::from_value(json).unwrap();
        let restored = Engine::from_game_state(4, 4, 0, moves, restored_gs);

        assert_eq!(restored.board(), engine.board());
        assert_eq!(restored.captures(), engine.captures());
        assert_eq!(
            restored.stone_captures(Stone::Black),
            engine.stone_captures(Stone::Black)
        );
        assert_eq!(
            restored.stone_captures(Stone::White),
            engine.stone_captures(Stone::White)
        );
    }
}
