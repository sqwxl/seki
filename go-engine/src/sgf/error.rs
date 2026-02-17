use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SgfError {
    UnexpectedChar {
        expected: &'static str,
        found: char,
        pos: usize,
    },
    UnexpectedEof,
    InvalidPropertyValue {
        property: String,
        value: String,
        reason: String,
    },
    InvalidCoordinate(String),
    EmptyCollection,
}

impl fmt::Display for SgfError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SgfError::UnexpectedChar {
                expected,
                found,
                pos,
            } => write!(f, "expected {expected}, found '{found}' at position {pos}"),
            SgfError::UnexpectedEof => write!(f, "unexpected end of input"),
            SgfError::InvalidPropertyValue {
                property,
                value,
                reason,
            } => write!(
                f,
                "invalid value '{value}' for property {property}: {reason}"
            ),
            SgfError::InvalidCoordinate(s) => write!(f, "invalid coordinate: {s}"),
            SgfError::EmptyCollection => write!(f, "SGF contains no game trees"),
        }
    }
}

impl std::error::Error for SgfError {}
