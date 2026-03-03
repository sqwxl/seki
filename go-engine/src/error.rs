use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GoError {
    OutOfTurn,
    Overwrite,
    Suicide,
    NotOnBoard,
    KoViolation,
    NoMovesToUndo,
}

impl fmt::Display for GoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GoError::OutOfTurn => write!(f, "out of turn"),
            GoError::Overwrite => write!(f, "overwrite"),
            GoError::Suicide => write!(f, "suicide"),
            GoError::NotOnBoard => write!(f, "not on board"),
            GoError::KoViolation => write!(f, "ko violation"),
            GoError::NoMovesToUndo => write!(f, "no moves to undo"),
        }
    }
}

impl std::error::Error for GoError {}
