use crate::{Point, Stone};

use super::error::SgfError;
use super::types::*;

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

pub(crate) fn one_value(values: &[String], _ident: &str) -> Result<String, SgfError> {
    Ok(values.first().cloned().unwrap_or_default())
}

pub(crate) fn parse_u8(values: &[String], ident: &str) -> Result<u8, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    s.trim()
        .parse::<u8>()
        .map_err(|_| SgfError::InvalidPropertyValue {
            property: ident.to_string(),
            value: s.to_string(),
            reason: "expected integer 0-255".to_string(),
        })
}

pub(crate) fn parse_u32(values: &[String], ident: &str) -> Result<u32, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    s.trim()
        .parse::<u32>()
        .map_err(|_| SgfError::InvalidPropertyValue {
            property: ident.to_string(),
            value: s.to_string(),
            reason: "expected non-negative integer".to_string(),
        })
}

pub(crate) fn parse_f64(values: &[String], ident: &str) -> Result<f64, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    s.trim()
        .parse::<f64>()
        .map_err(|_| SgfError::InvalidPropertyValue {
            property: ident.to_string(),
            value: s.to_string(),
            reason: "expected number".to_string(),
        })
}

pub(crate) fn parse_double(values: &[String], ident: &str) -> Result<Double, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("1");
    match s.trim() {
        "1" | "" => Ok(Double::Normal),
        "2" => Ok(Double::Emphasized),
        _ => Err(SgfError::InvalidPropertyValue {
            property: ident.to_string(),
            value: s.to_string(),
            reason: "expected 1 or 2".to_string(),
        }),
    }
}

pub(crate) fn parse_color(values: &[String], ident: &str) -> Result<Stone, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    match s.trim() {
        "B" => Ok(Stone::Black),
        "W" => Ok(Stone::White),
        _ => Err(SgfError::InvalidPropertyValue {
            property: ident.to_string(),
            value: s.to_string(),
            reason: "expected B or W".to_string(),
        }),
    }
}

/// Parse SZ — either "19" (square) or "19:13" (cols:rows).
pub(crate) fn parse_sz(values: &[String]) -> Result<Property, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    let trimmed = s.trim();
    if let Some((c, r)) = trimmed.split_once(':') {
        let cols = c
            .parse::<u8>()
            .map_err(|_| SgfError::InvalidPropertyValue {
                property: "SZ".to_string(),
                value: s.to_string(),
                reason: "invalid board width".to_string(),
            })?;
        let rows = r
            .parse::<u8>()
            .map_err(|_| SgfError::InvalidPropertyValue {
                property: "SZ".to_string(),
                value: s.to_string(),
                reason: "invalid board height".to_string(),
            })?;
        Ok(Property::BoardSize(cols, rows))
    } else {
        let size = trimmed
            .parse::<u8>()
            .map_err(|_| SgfError::InvalidPropertyValue {
                property: "SZ".to_string(),
                value: s.to_string(),
                reason: "invalid board size".to_string(),
            })?;
        Ok(Property::BoardSize(size, size))
    }
}

/// Parse AP — "name:version".
pub(crate) fn parse_ap(values: &[String]) -> Result<Property, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    match s.split_once(':') {
        Some((name, version)) => Ok(Property::ApplicationNameVersion(
            name.to_string(),
            version.to_string(),
        )),
        None => Ok(Property::ApplicationNameVersion(
            s.to_string(),
            String::new(),
        )),
    }
}

/// Parse FG — empty means None, otherwise "flags:name".
pub(crate) fn parse_fg(values: &[String]) -> Result<Property, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    if s.is_empty() {
        return Ok(Property::Figure(None));
    }
    match s.split_once(':') {
        Some((flags, name)) => {
            let n = flags
                .trim()
                .parse::<u32>()
                .map_err(|_| SgfError::InvalidPropertyValue {
                    property: "FG".to_string(),
                    value: s.to_string(),
                    reason: "invalid figure flags".to_string(),
                })?;
            Ok(Property::Figure(Some((n, name.to_string()))))
        }
        None => {
            let n = s
                .trim()
                .parse::<u32>()
                .map_err(|_| SgfError::InvalidPropertyValue {
                    property: "FG".to_string(),
                    value: s.to_string(),
                    reason: "invalid figure flags".to_string(),
                })?;
            Ok(Property::Figure(Some((n, String::new()))))
        }
    }
}

// ---------------------------------------------------------------------------
// Coordinate parsing
// ---------------------------------------------------------------------------

/// SGF letter to 0-based index: a=0 .. z=25, A=26 .. Z=51.
pub(crate) fn letter_to_coord(ch: char) -> Result<u8, SgfError> {
    match ch {
        'a'..='z' => Ok(ch as u8 - b'a'),
        'A'..='Z' => Ok(ch as u8 - b'A' + 26),
        _ => Err(SgfError::InvalidCoordinate(ch.to_string())),
    }
}

/// Parse a 2-char coordinate string like "cd" → (2, 3).
/// SGF coordinates are (column, row) with 'a' = 0.
pub(crate) fn parse_point(s: &str) -> Result<Point, SgfError> {
    let mut chars = s.chars();
    let col_ch = chars
        .next()
        .ok_or_else(|| SgfError::InvalidCoordinate(s.to_string()))?;
    let row_ch = chars
        .next()
        .ok_or_else(|| SgfError::InvalidCoordinate(s.to_string()))?;
    if chars.next().is_some() {
        return Err(SgfError::InvalidCoordinate(s.to_string()));
    }
    Ok((letter_to_coord(col_ch)?, letter_to_coord(row_ch)?))
}

/// Parse a move point value. Empty string always means pass.
/// "tt" means pass on boards ≤ 19×19, but is a valid coordinate (19,19) on larger boards.
/// TODO(human): decide how to handle "tt" — see Learn by Doing request.
pub(crate) fn parse_move_point(values: &[String], _ident: &str) -> Result<Option<Point>, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    if s.is_empty() {
        return Ok(None);
    }
    parse_point(s).map(Some)
}

/// Parse a list of points, with support for compressed point lists [aa:cc].
pub(crate) fn parse_point_list(values: &[String], _ident: &str) -> Result<Vec<Point>, SgfError> {
    let mut points = Vec::new();
    for val in values {
        if val.is_empty() {
            continue;
        }
        if let Some((from, to)) = val.split_once(':') {
            // Compressed point list: expand rectangle
            let (c1, r1) = parse_point(from)?;
            let (c2, r2) = parse_point(to)?;
            let min_c = c1.min(c2);
            let max_c = c1.max(c2);
            let min_r = r1.min(r2);
            let max_r = r1.max(r2);
            for r in min_r..=max_r {
                for c in min_c..=max_c {
                    points.push((c, r));
                }
            }
        } else {
            points.push(parse_point(val)?);
        }
    }
    Ok(points)
}

/// Parse a list of point pairs (e.g. for AR[], LN[]).
pub(crate) fn parse_point_pair_list(
    values: &[String],
    ident: &str,
) -> Result<Vec<PointPair>, SgfError> {
    let mut pairs = Vec::new();
    for val in values {
        let (from_s, to_s) = val
            .split_once(':')
            .ok_or_else(|| SgfError::InvalidPropertyValue {
                property: ident.to_string(),
                value: val.clone(),
                reason: "expected point:point".to_string(),
            })?;
        pairs.push(PointPair {
            from: parse_point(from_s)?,
            to: parse_point(to_s)?,
        });
    }
    Ok(pairs)
}

/// Parse a list of labels (e.g. LB[cd:A][ef:B]).
pub(crate) fn parse_label_list(values: &[String], ident: &str) -> Result<Vec<Label>, SgfError> {
    let mut labels = Vec::new();
    for val in values {
        let (point_s, text) =
            val.split_once(':')
                .ok_or_else(|| SgfError::InvalidPropertyValue {
                    property: ident.to_string(),
                    value: val.clone(),
                    reason: "expected point:text".to_string(),
                })?;
        labels.push(Label {
            point: parse_point(point_s)?,
            text: text.to_string(),
        });
    }
    Ok(labels)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinate_a_is_0() {
        assert_eq!(letter_to_coord('a').unwrap(), 0);
        assert_eq!(letter_to_coord('s').unwrap(), 18);
        assert_eq!(letter_to_coord('z').unwrap(), 25);
        assert_eq!(letter_to_coord('A').unwrap(), 26);
    }
}
