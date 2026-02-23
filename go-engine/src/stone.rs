use serde_repr::{Deserialize_repr, Serialize_repr};
use std::fmt;
use std::ops::Neg;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize_repr, Deserialize_repr)]
#[repr(i8)]
pub enum Stone {
    Black = 1,
    White = -1,
}

impl Stone {
    pub fn from_int(v: i8) -> Option<Self> {
        match v.signum() {
            1 => Some(Stone::Black),
            -1 => Some(Stone::White),
            _ => None,
        }
    }

    pub fn to_int(self) -> i8 {
        self as i8
    }

    pub fn opp(self) -> Self {
        match self {
            Stone::Black => Stone::White,
            Stone::White => Stone::Black,
        }
    }

    pub fn letter(self) -> &'static str {
        match self {
            Stone::Black => "B",
            Stone::White => "W",
        }
    }
}

impl Neg for Stone {
    type Output = Self;

    fn neg(self) -> Self {
        self.opp()
    }
}

impl fmt::Display for Stone {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Stone::Black => write!(f, "Black"),
            Stone::White => write!(f, "White"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_int_normalizes() {
        assert_eq!(Stone::from_int(1), Some(Stone::Black));
        assert_eq!(Stone::from_int(5), Some(Stone::Black));
        assert_eq!(Stone::from_int(100), Some(Stone::Black));
        assert_eq!(Stone::from_int(-1), Some(Stone::White));
        assert_eq!(Stone::from_int(-5), Some(Stone::White));
        assert_eq!(Stone::from_int(-100), Some(Stone::White));
        assert_eq!(Stone::from_int(0), None);
    }

    #[test]
    fn opponent() {
        assert_eq!(Stone::Black.opp(), Stone::White);
        assert_eq!(Stone::White.opp(), Stone::Black);
    }

    #[test]
    fn negation() {
        assert_eq!(-Stone::Black, Stone::White);
        assert_eq!(-Stone::White, Stone::Black);
    }

    #[test]
    fn display() {
        assert_eq!(Stone::Black.to_string(), "Black");
        assert_eq!(Stone::White.to_string(), "White");
    }
}
