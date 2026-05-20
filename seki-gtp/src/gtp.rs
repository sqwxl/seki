use std::fmt;

use go_engine::Stone;

#[derive(Debug, Clone)]
pub enum GtpResponse {
    Success { id: Option<u32>, text: Vec<String> },
    Error { id: Option<u32>, text: String },
}

impl GtpResponse {
    pub fn is_success(&self) -> bool {
        matches!(self, GtpResponse::Success { .. })
    }

    pub fn text(&self) -> &str {
        match self {
            GtpResponse::Success { text, .. } => text.first().map(|s| s.as_str()).unwrap_or(""),
            GtpResponse::Error { text, .. } => text.as_str(),
        }
    }
}

impl fmt::Display for GtpResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GtpResponse::Success { id, text } => {
                if let Some(id) = id {
                    write!(f, "={id} {}", text.join("\n"))
                } else {
                    write!(f, "= {}", text.join("\n"))
                }
            }
            GtpResponse::Error { id, text } => {
                if let Some(id) = id {
                    write!(f, "?{id} {text}")
                } else {
                    write!(f, "? {text}")
                }
            }
        }
    }
}

/// Convert a seki (0-indexed, top-left) coordinate to GTP format (column letter A-T, row from bottom).
pub fn seki_to_gtp(col: u8, row: u8, size: u8) -> String {
    let col_char = if col >= 8 {
        (b'A' + col + 1) as char
    } else {
        (b'A' + col) as char
    };
    let row_num = size - row;
    format!("{col_char}{row_num}")
}

/// Convert a GTP coordinate string to seki (0-indexed, top-left).
pub fn gtp_to_seki(gtp: &str, size: u8) -> Option<(u8, u8)> {
    let gtp = gtp.trim().to_uppercase();
    if gtp.len() < 2 {
        return None;
    }
    let bytes = gtp.as_bytes();
    let col_char = bytes[0];
    let row_str = &gtp[1..];
    let row_num: u8 = row_str.parse().ok()?;
    if row_num < 1 || row_num > size {
        return None;
    }
    let col = if col_char > b'I' {
        col_char - b'A' - 1
    } else {
        col_char - b'A'
    };
    if col >= size {
        return None;
    }
    let row = size - row_num;
    Some((col, row))
}

/// Convert a go_engine::Stone to GTP color string ("B" or "W").
pub fn stone_to_gtp(stone: Stone) -> &'static str {
    match stone {
        Stone::Black => "B",
        Stone::White => "W",
    }
}

/// Parse a single line of GTP response.
pub fn parse_response_line(line: &str) -> GtpResponse {
    let line = line.trim();
    if line.is_empty() {
        return GtpResponse::Success {
            id: None,
            text: vec![],
        };
    }

    let is_error = line.starts_with('?');
    let content = &line[1..];
    let content = content.trim();

    let (id, text) = if let Some(space_idx) = content.find(' ') {
        let first = &content[..space_idx];
        let rest = &content[space_idx + 1..].trim();
        if let Ok(num) = first.parse::<u32>() {
            (Some(num), rest.to_string())
        } else {
            (None, content.to_string())
        }
    } else {
        if let Ok(num) = content.parse::<u32>() {
            (Some(num), String::new())
        } else {
            (None, content.to_string())
        }
    };

    if is_error {
        GtpResponse::Error { id, text }
    } else {
        GtpResponse::Success {
            id,
            text: vec![text],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gtp_to_seki() {
        assert_eq!(gtp_to_seki("A1", 19), Some((0, 18)));
        assert_eq!(gtp_to_seki("T19", 19), Some((18, 0)));
        assert_eq!(gtp_to_seki("J1", 19), Some((8, 18)));
        assert_eq!(gtp_to_seki("A19", 19), Some((0, 0)));
        assert_eq!(gtp_to_seki("pass", 19), None);
    }

    #[test]
    fn test_seki_to_gtp() {
        assert_eq!(seki_to_gtp(0, 18, 19), "A1");
        assert_eq!(seki_to_gtp(18, 0, 19), "T19");
        assert_eq!(seki_to_gtp(8, 18, 19), "J1");
        assert_eq!(seki_to_gtp(0, 0, 19), "A19");
    }

    #[test]
    fn test_parse_success() {
        let r = parse_response_line("= D4");
        assert!(r.is_success());
        assert_eq!(r.text(), "D4");
    }

    #[test]
    fn test_parse_error() {
        let r = parse_response_line("? illegal move");
        assert!(!r.is_success());
        assert_eq!(r.text(), "illegal move");
    }

    #[test]
    fn test_parse_with_id() {
        let r = parse_response_line("=15 D4");
        assert!(r.is_success());
    }
}
