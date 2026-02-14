use serde::{Deserialize, Serialize};
use std::fmt;

use crate::stone::Stone;
use crate::Point;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Move {
    Play,
    Pass,
    Resign,
}

impl std::str::FromStr for Move {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "play" => Ok(Move::Play),
            "pass" => Ok(Move::Pass),
            "resign" => Ok(Move::Resign),
            _ => Err(format!("invalid move: {s}")),
        }
    }
}

impl fmt::Display for Move {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Move::Play => write!(f, "play"),
            Move::Pass => write!(f, "pass"),
            Move::Resign => write!(f, "resign"),
        }
    }
}

/// Represents a single turn in a game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Turn {
    pub kind: Move,
    pub stone: Stone,
    pub pos: Option<Point>,
}

impl Turn {
    pub fn play(stone: Stone, point: Point) -> Self {
        Turn {
            kind: Move::Play,
            stone,
            pos: Some(point),
        }
    }

    pub fn pass(stone: Stone) -> Self {
        Turn {
            kind: Move::Pass,
            stone,
            pos: None,
        }
    }

    pub fn resign(stone: Stone) -> Self {
        Turn {
            kind: Move::Resign,
            stone,
            pos: None,
        }
    }

    pub fn is_play(&self) -> bool {
        self.kind == Move::Play
    }

    pub fn is_pass(&self) -> bool {
        self.kind == Move::Pass
    }

    pub fn is_resign(&self) -> bool {
        self.kind == Move::Resign
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_move() {
        let t = Turn::play(Stone::Black, (0, 0));
        assert_eq!(t.kind, Move::Play);
        assert_eq!(t.stone, Stone::Black);
        assert_eq!(t.pos, Some((0, 0)));
        assert!(t.is_play());
        assert!(!t.is_pass());
        assert!(!t.is_resign());
    }

    #[test]
    fn pass_move() {
        let t = Turn::pass(Stone::White);
        assert_eq!(t.kind, Move::Pass);
        assert_eq!(t.stone, Stone::White);
        assert_eq!(t.pos, None);
        assert!(t.is_pass());
        assert!(!t.is_play());
    }

    #[test]
    fn resign_move() {
        let t = Turn::resign(Stone::Black);
        assert_eq!(t.kind, Move::Resign);
        assert!(t.is_resign());
    }

    #[test]
    fn equality() {
        let t1 = Turn::play(Stone::Black, (1, 1));
        let t2 = Turn::play(Stone::Black, (1, 1));
        let t3 = Turn::play(Stone::White, (1, 1));
        assert_eq!(t1, t2);
        assert_ne!(t1, t3);
    }
}
