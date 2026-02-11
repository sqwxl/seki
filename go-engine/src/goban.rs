use arrayvec::ArrayVec;

use crate::error::GoError;
use crate::ko::Ko;
use crate::stone::Stone;
use crate::turn::{Move, Turn};
use crate::Point;

/// Captures indexed by stone color.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub struct Captures {
    pub black: u32,
    pub white: u32,
}

impl Captures {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, stone: Stone) -> u32 {
        match stone {
            Stone::Black => self.black,
            Stone::White => self.white,
        }
    }

    fn add(&mut self, stone: Stone, count: u32) {
        match stone {
            Stone::Black => self.black += count,
            Stone::White => self.white += count,
        }
    }
}

/// The Go board stored as a flat array.
#[derive(Debug, Clone, PartialEq)]
pub struct Goban {
    board: Vec<i8>,
    cols: u8,
    rows: u8,
    captures: Captures,
    ko: Option<Ko>,
}

impl Goban {
    /// Create a goban from an existing board matrix (rows x cols of i8 values).
    pub fn new(board: Vec<Vec<i8>>) -> Self {
        let rows = board.len() as u8;
        let cols = if rows == 0 { 0 } else { board[0].len() as u8 };

        assert!(
            board.iter().all(|row| row.len() == cols as usize),
            "malformed board matrix"
        );

        Goban {
            board: board.into_iter().flatten().collect(),
            cols,
            rows,
            captures: Captures::new(),
            ko: None,
        }
    }

    /// Create an empty board with the given dimensions.
    pub fn with_dimensions(cols: u8, rows: u8) -> Self {
        Goban {
            board: vec![0i8; cols as usize * rows as usize],
            cols,
            rows,
            captures: Captures::new(),
            ko: None,
        }
    }

    /// Replay a list of turns onto an empty board of the given dimensions.
    pub fn with_moves(cols: u8, rows: u8, moves: &[Turn]) -> Self {
        let mut goban = Goban::with_dimensions(cols, rows);

        for m in moves {
            match m.kind {
                Move::Play => {
                    let point = m.pos.expect("play move must have a point");
                    goban = goban.play(point, m.stone).expect("invalid move in replay");
                }
                Move::Pass => goban.pass(),
                Move::Resign => {}
            }
        }

        goban
    }

    /// Restore a goban from serialized state.
    pub fn from_state(
        board: Vec<i8>,
        cols: u8,
        rows: u8,
        captures: Captures,
        ko: Option<Ko>,
    ) -> Self {
        Goban {
            board,
            cols,
            rows,
            captures,
            ko,
        }
    }

    // -- Accessors --

    pub fn board(&self) -> &[i8] {
        &self.board
    }

    pub fn cols(&self) -> u8 {
        self.cols
    }

    pub fn rows(&self) -> u8 {
        self.rows
    }

    pub fn captures(&self) -> &Captures {
        &self.captures
    }

    pub fn ko(&self) -> &Option<Ko> {
        &self.ko
    }

    pub fn stone_at(&self, point: Point) -> Option<Stone> {
        let (col, row) = point;
        if self.on_board(point) {
            Stone::from_int(self.board[self.idx(col, row)])
        } else {
            None
        }
    }

    pub fn on_board(&self, (col, row): Point) -> bool {
        col < self.cols && row < self.rows
    }

    pub fn is_empty(&self) -> bool {
        self.board.iter().all(|&s| s == 0)
    }

    // -- Game actions --

    /// Place a stone on the board. Returns a new Goban with the move applied, or an error.
    pub fn play(&self, point: Point, stone: Stone) -> Result<Goban, GoError> {
        let (mut goban, dead_stones, liberties) = self.place_stone(point, stone)?;

        let ko = Self::detect_ko(&goban, &dead_stones, &liberties, point, stone);
        goban.ko = ko;

        Ok(goban)
    }

    /// Pass: clears ko in place.
    pub fn pass(&mut self) {
        self.ko = None;
    }

    /// Place a stone, resolve captures, check for suicide.
    pub(crate) fn place_stone(
        &self,
        point: Point,
        stone: Stone,
    ) -> Result<(Goban, Vec<Point>, Vec<Point>), GoError> {
        if !self.on_board(point) {
            return Err(GoError::NotOnBoard);
        }

        if self.stone_at(point).is_some() {
            return Err(GoError::Overwrite);
        }

        let mut goban = self.clone();
        goban.set_stone(point, stone);

        if goban.is_ko(point, stone) {
            return Err(GoError::KoViolation);
        }

        // Find and remove captured opponent chains
        let mut dead_stones = Vec::new();
        let neighbor_chains = goban.opponent_neighbor_chains(point);
        for chain in &neighbor_chains {
            if goban.chain_liberties(chain).is_empty() {
                dead_stones.extend(chain);
            }
        }

        goban.capture_mut(&dead_stones);

        // Check suicide
        let liberties = goban.liberties(point);
        if liberties.is_empty() {
            return Err(GoError::Suicide);
        }

        Ok((goban, dead_stones, liberties))
    }

    /// Remove captured stones from the board in place.
    fn capture_mut(&mut self, stones: &[Point]) {
        if stones.is_empty() {
            return;
        }

        let stone_color = self.stone_at(stones[0]).unwrap();
        let capturing_color = stone_color.opp();

        for &pt in stones {
            self.clear_stone(pt);
        }
        self.captures.add(capturing_color, stones.len() as u32);
    }

    // -- Graph algorithms --

    /// Get the 4-connected neighbors that are on the board.
    pub fn neighbors(&self, (col, row): Point) -> ArrayVec<Point, 4> {
        let mut result = ArrayVec::new();
        if col > 0 {
            result.push((col - 1, row));
        }
        if col + 1 < self.cols {
            result.push((col + 1, row));
        }
        if row > 0 {
            result.push((col, row - 1));
        }
        if row + 1 < self.rows {
            result.push((col, row + 1));
        }
        result
    }

    /// Flood-fill connected group of same-colored stones.
    pub fn chain(&self, point: Point) -> Vec<Point> {
        let stone = match self.stone_at(point) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let mut visited = vec![false; self.board.len()];
        let mut result = Vec::new();
        let mut stack = vec![point];

        while let Some(p) = stack.pop() {
            let vi = self.idx(p.0, p.1);
            if visited[vi] {
                continue;
            }
            visited[vi] = true;
            result.push(p);
            for n in self.neighbors(p) {
                if self.stone_at(n) == Some(stone) && !visited[self.idx(n.0, n.1)] {
                    stack.push(n);
                }
            }
        }

        result
    }

    /// Get the liberties of a single stone's connected group.
    pub fn liberties(&self, point: Point) -> Vec<Point> {
        let chain = self.chain(point);
        self.chain_liberties(&chain)
    }

    /// Get the liberties of a chain (pre-computed group of points).
    pub fn chain_liberties(&self, chain: &[Point]) -> Vec<Point> {
        let mut seen = vec![false; self.board.len()];
        let mut libs = Vec::new();
        for &p in chain {
            for n in self.neighbors(p) {
                let ni = self.idx(n.0, n.1);
                if !seen[ni] && self.stone_at(n).is_none() {
                    seen[ni] = true;
                    libs.push(n);
                }
            }
        }
        libs
    }

    /// Find all opponent chains neighboring a given point.
    fn opponent_neighbor_chains(&self, point: Point) -> Vec<Vec<Point>> {
        let stone = match self.stone_at(point) {
            Some(s) => s,
            _ => return Vec::new(),
        };
        let opponent = stone.opp();

        let mut chains = Vec::new();
        let mut visited = vec![false; self.board.len()];

        for n in self.neighbors(point) {
            if self.stone_at(n) != Some(opponent) {
                continue;
            }
            if visited[self.idx(n.0, n.1)] {
                continue;
            }
            let ch = self.chain_from(n, &mut visited);
            if !ch.is_empty() {
                chains.push(ch);
            }
        }

        chains
    }

    /// Chain flood-fill using a shared visited bitset.
    fn chain_from(&self, point: Point, visited: &mut [bool]) -> Vec<Point> {
        let stone = match self.stone_at(point) {
            Some(s) => s,
            None => return Vec::new(),
        };

        let mut result = Vec::new();
        let mut stack = vec![point];

        while let Some(p) = stack.pop() {
            let vi = self.idx(p.0, p.1);
            if visited[vi] {
                continue;
            }
            visited[vi] = true;
            result.push(p);
            for n in self.neighbors(p) {
                if self.stone_at(n) == Some(stone) && !visited[self.idx(n.0, n.1)] {
                    stack.push(n);
                }
            }
        }

        result
    }

    // -- Internal helpers --

    #[inline]
    fn idx(&self, col: u8, row: u8) -> usize {
        row as usize * self.cols as usize + col as usize
    }

    fn set_stone(&mut self, (col, row): Point, stone: Stone) {
        if self.on_board((col, row)) {
            let i = self.idx(col, row);
            self.board[i] = stone.to_int();
        }
    }

    fn clear_stone(&mut self, (col, row): Point) {
        if self.on_board((col, row)) {
            let i = self.idx(col, row);
            self.board[i] = 0;
        }
    }

    fn is_ko(&self, point: Point, stone: Stone) -> bool {
        self.ko
            .as_ref()
            .is_some_and(|ko| ko.pos == (point.0 as i8, point.1 as i8) && ko.illegal == stone)
    }

    fn detect_ko(
        goban: &Goban,
        dead_stones: &[Point],
        liberties: &[Point],
        point: Point,
        stone: Stone,
    ) -> Option<Ko> {
        let is_ko = dead_stones.len() == 1
            && liberties.len() == 1
            && liberties[0] == dead_stones[0]
            && goban
                .neighbors(point)
                .iter()
                .all(|&n| goban.stone_at(n) != Some(stone));

        if is_ko {
            let ko_point = dead_stones[0];
            Some(Ko {
                pos: (ko_point.0 as i8, ko_point.1 as i8),
                illegal: stone.opp(),
            })
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test helper: build a goban from an ASCII layout. 'B' = Black, 'W' = White, '+' = Empty.
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

    #[test]
    fn creates_empty_board() {
        let goban = Goban::with_dimensions(4, 4);
        assert!(goban.is_empty());
    }

    #[test]
    fn creates_board_with_dimensions() {
        let goban = Goban::with_dimensions(5, 3);
        assert_eq!(goban.cols(), 5);
        assert_eq!(goban.rows(), 3);
        assert_eq!(goban.board().len(), 15);
    }

    #[test]
    #[should_panic(expected = "malformed")]
    fn rejects_malformed_board() {
        Goban::new(vec![vec![0], vec![0, 0]]);
    }

    #[test]
    fn prevents_overwrite() {
        let goban = Goban::with_dimensions(4, 4);
        let goban = goban.play((0, 0), Stone::Black).unwrap();
        let result = goban.play((0, 0), Stone::White);
        assert_eq!(result, Err(GoError::Overwrite));
    }

    #[test]
    fn prevents_ko_violation() {
        let goban = goban_from_layout(&["+BW+", "BW+W", "+BW+", "++++"]);
        let goban = goban.play((2, 1), Stone::Black).unwrap();
        let result = goban.play((1, 1), Stone::White);
        assert_eq!(result, Err(GoError::KoViolation));
    }

    #[test]
    fn prevents_suicide() {
        let goban = goban_from_layout(&["+B++", "B+++", "++++", "++++"]);
        let result = goban.play((0, 0), Stone::White);
        assert_eq!(result, Err(GoError::Suicide));
    }

    #[test]
    fn captures_single_stone() {
        let goban = goban_from_layout(&["+B++", "BWB+", "++++", "++++"]);
        let goban = goban.play((1, 2), Stone::Black).unwrap();
        assert_eq!(goban.captures().black, 1);
    }

    #[test]
    fn captures_stone_chain() {
        let goban = goban_from_layout(&["+BB+", "BWWB", "W+WB", "WWB+"]);
        let goban = goban.play((1, 2), Stone::Black).unwrap();
        assert_eq!(goban.captures().black, 6);
    }

    #[test]
    fn on_board_check() {
        let goban = Goban::with_dimensions(4, 4);
        assert!(goban.on_board((0, 0)));
        assert!(goban.on_board((3, 3)));
        assert!(!goban.on_board((4, 0)));
        assert!(!goban.on_board((0, 4)));
    }

    #[test]
    fn stone_at_position() {
        let goban = Goban::with_dimensions(4, 4);
        let goban = goban.play((1, 1), Stone::Black).unwrap();
        assert_eq!(goban.stone_at((1, 1)), Some(Stone::Black));
        assert_eq!(goban.stone_at((0, 0)), None);
        assert_eq!(goban.stone_at((5, 5)), None);
    }

    #[test]
    fn captures_surrounded_stone() {
        let mut goban = Goban::with_dimensions(4, 4);
        goban = goban.play((1, 1), Stone::Black).unwrap();
        goban = goban.play((0, 1), Stone::White).unwrap();
        goban = goban.play((2, 1), Stone::White).unwrap();
        goban = goban.play((1, 0), Stone::White).unwrap();
        goban = goban.play((1, 2), Stone::White).unwrap();

        assert_eq!(goban.stone_at((1, 1)), None);
        assert_eq!(goban.captures().white, 1);
    }

    #[test]
    fn captures_corner_stone() {
        let mut goban = Goban::with_dimensions(4, 4);
        goban = goban.play((0, 0), Stone::Black).unwrap();
        goban = goban.play((1, 0), Stone::White).unwrap();
        goban = goban.play((0, 1), Stone::White).unwrap();

        assert_eq!(goban.stone_at((0, 0)), None);
        assert_eq!(goban.captures().white, 1);
    }

    #[test]
    fn pass_clears_ko() {
        let goban = goban_from_layout(&["+BW+", "BW+W", "+BW+", "++++"]);
        let mut goban = goban.play((2, 1), Stone::Black).unwrap();
        assert!(goban.ko().is_some());

        goban.pass();
        assert!(goban.ko().is_none());
    }
}
