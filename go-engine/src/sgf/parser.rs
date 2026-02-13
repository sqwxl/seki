use crate::{Point, Stone};

use super::error::SgfError;
use super::types::*;

/// Parse an SGF string into a Collection (Vec<GameTree>).
pub fn parse(input: &str) -> Result<Collection, SgfError> {
    let mut p = Parser::new(input);
    let collection = p.collection()?;
    if collection.is_empty() {
        return Err(SgfError::EmptyCollection);
    }
    Ok(collection)
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(input: &'a str) -> Self {
        Parser {
            bytes: input.as_bytes(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn advance(&mut self) -> Option<u8> {
        let b = self.bytes.get(self.pos).copied()?;
        self.pos += 1;
        Some(b)
    }

    fn skip_whitespace(&mut self) {
        while let Some(b) = self.peek() {
            if b.is_ascii_whitespace() {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn expect(&mut self, ch: u8) -> Result<(), SgfError> {
        self.skip_whitespace();
        match self.advance() {
            Some(b) if b == ch => Ok(()),
            Some(b) => Err(SgfError::UnexpectedChar {
                expected: expected_str(ch),
                found: b as char,
                pos: self.pos - 1,
            }),
            None => Err(SgfError::UnexpectedEof),
        }
    }

    // Collection = GameTree+
    fn collection(&mut self) -> Result<Collection, SgfError> {
        let mut trees = Vec::new();
        loop {
            self.skip_whitespace();
            if self.peek() == Some(b'(') {
                let mut game_tree = self.game_tree()?;
                tt_fixup(&mut game_tree);
                trees.push(game_tree);
            } else {
                break;
            }
        }
        Ok(trees)
    }

    // GameTree = '(' Sequence GameTree* ')'
    fn game_tree(&mut self) -> Result<GameTree, SgfError> {
        self.expect(b'(')?;
        let nodes = self.sequence()?;
        let mut variations = Vec::new();
        loop {
            self.skip_whitespace();
            if self.peek() == Some(b'(') {
                variations.push(self.game_tree()?);
            } else {
                break;
            }
        }
        self.expect(b')')?;
        Ok(GameTree { nodes, variations })
    }

    // Sequence = Node+
    fn sequence(&mut self) -> Result<Vec<Node>, SgfError> {
        let mut nodes = Vec::new();
        loop {
            self.skip_whitespace();
            if self.peek() == Some(b';') {
                nodes.push(self.node()?);
            } else {
                break;
            }
        }
        Ok(nodes)
    }

    // Node = ';' Property*
    fn node(&mut self) -> Result<Node, SgfError> {
        self.expect(b';')?;
        let mut raw_props = Vec::new();
        loop {
            self.skip_whitespace();
            match self.peek() {
                Some(b) if b.is_ascii_uppercase() => {
                    raw_props.push(self.raw_property()?);
                }
                _ => break,
            }
        }
        let properties = raw_props
            .into_iter()
            .map(|(ident, values)| convert_property(ident, values))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Node { properties })
    }

    // Property = Ident Value+
    // Ident = UcLetter+
    // Value = '[' CValueType ']'
    fn raw_property(&mut self) -> Result<(String, Vec<String>), SgfError> {
        let ident = self.prop_ident()?;
        let mut values = Vec::new();
        loop {
            self.skip_whitespace();
            if self.peek() == Some(b'[') {
                values.push(self.prop_value()?);
            } else {
                break;
            }
        }
        Ok((ident, values))
    }

    fn prop_ident(&mut self) -> Result<String, SgfError> {
        let mut ident = Vec::new();
        while let Some(b) = self.peek() {
            if b.is_ascii_uppercase() {
                ident.push(b);
                self.pos += 1;
            } else {
                break;
            }
        }
        Ok(String::from_utf8(ident).unwrap())
    }

    fn prop_value(&mut self) -> Result<String, SgfError> {
        self.expect(b'[')?;
        let mut value = String::new();
        loop {
            match self.advance() {
                None => return Err(SgfError::UnexpectedEof),
                Some(b'\\') => {
                    // Escape: next char is literal (or soft line break)
                    match self.advance() {
                        None => return Err(SgfError::UnexpectedEof),
                        Some(b'\n') => {
                            // Soft line break — skip \r if present after
                            if self.peek() == Some(b'\r') {
                                self.pos += 1;
                            }
                            // Removed entirely
                        }
                        Some(b'\r') => {
                            // Soft line break — skip \n if present after
                            if self.peek() == Some(b'\n') {
                                self.pos += 1;
                            }
                            // Removed entirely
                        }
                        Some(ch) => value.push(ch as char),
                    }
                }
                Some(b']') => break,
                Some(ch) => value.push(ch as char),
            }
        }
        Ok(value)
    }
}

fn expected_str(ch: u8) -> &'static str {
    match ch {
        b'(' => "'('",
        b')' => "')'",
        b';' => "';'",
        b'[' => "'['",
        _ => "character",
    }
}

fn convert_property(ident: String, values: Vec<String>) -> Result<Property, SgfError> {
    let prop = match ident.as_str() {
        // -- Move --
        "B" => Property::Black(parse_move_point(&values, &ident)?),
        "W" => Property::White(parse_move_point(&values, &ident)?),
        "KO" => Property::Ko,
        "MN" => Property::MoveNumber(parse_u32(&values, &ident)?),

        // -- Setup --
        "AB" => Property::AddBlack(parse_point_list(&values, &ident)?),
        "AW" => Property::AddWhite(parse_point_list(&values, &ident)?),
        "AE" => Property::AddEmpty(parse_point_list(&values, &ident)?),
        "PL" => Property::PlayerToPlay(parse_color(&values, &ident)?),

        // -- Root --
        "FF" => Property::FileFormat(parse_u8(&values, &ident)?),
        "GM" => Property::GameType(parse_u8(&values, &ident)?),
        "SZ" => parse_sz(&values)?,
        "AP" => parse_ap(&values)?,
        "CA" => Property::CharacterSet(one_value(&values, &ident)?),
        "ST" => Property::Style(parse_u8(&values, &ident)?),

        // -- Game info (all simple text) --
        "PB" => Property::BlackName(one_value(&values, &ident)?),
        "PW" => Property::WhiteName(one_value(&values, &ident)?),
        "BR" => Property::BlackRank(one_value(&values, &ident)?),
        "WR" => Property::WhiteRank(one_value(&values, &ident)?),
        "BT" => Property::BlackTeam(one_value(&values, &ident)?),
        "WT" => Property::WhiteTeam(one_value(&values, &ident)?),
        "EV" => Property::EventName(one_value(&values, &ident)?),
        "RO" => Property::Round(one_value(&values, &ident)?),
        "DT" => Property::Date(one_value(&values, &ident)?),
        "PC" => Property::Place(one_value(&values, &ident)?),
        "RU" => Property::Rules(one_value(&values, &ident)?),
        "RE" => Property::Result(one_value(&values, &ident)?),
        "TM" => Property::TimeLimitSeconds(parse_f64(&values, &ident)?),
        "OT" => Property::OvertimeDescription(one_value(&values, &ident)?),
        "GN" => Property::GameName(one_value(&values, &ident)?),
        "GC" => Property::GameComment(one_value(&values, &ident)?),
        "ON" => Property::Opening(one_value(&values, &ident)?),
        "SO" => Property::Source(one_value(&values, &ident)?),
        "CP" => Property::Copyright(one_value(&values, &ident)?),
        "US" => Property::User(one_value(&values, &ident)?),
        "AN" => Property::Annotator(one_value(&values, &ident)?),

        // -- Go-specific --
        "HA" => Property::Handicap(parse_u8(&values, &ident)?),
        "KM" => Property::Komi(parse_f64(&values, &ident)?),
        "TB" => Property::TerritoryBlack(parse_point_list(&values, &ident)?),
        "TW" => Property::TerritoryWhite(parse_point_list(&values, &ident)?),

        // -- Annotation --
        "C" => Property::Comment(one_value(&values, &ident)?),
        "N" => Property::NodeName(one_value(&values, &ident)?),
        "V" => Property::NodeValue(parse_f64(&values, &ident)?),
        "DM" => Property::EvenPosition(parse_double(&values, &ident)?),
        "GB" => Property::GoodForBlack(parse_double(&values, &ident)?),
        "GW" => Property::GoodForWhite(parse_double(&values, &ident)?),
        "UC" => Property::UnclearPosition(parse_double(&values, &ident)?),
        "HO" => Property::Hotspot(parse_double(&values, &ident)?),

        // -- Move annotation --
        "BM" => Property::BadMove(parse_double(&values, &ident)?),
        "TE" => Property::Tesuji(parse_double(&values, &ident)?),
        "DO" => Property::DoubtfulMove,
        "IT" => Property::InterestingMove,

        // -- Markup --
        "AR" => Property::Arrows(parse_point_pair_list(&values, &ident)?),
        "CR" => Property::Circles(parse_point_list(&values, &ident)?),
        "MA" => Property::XMarks(parse_point_list(&values, &ident)?),
        "TR" => Property::Triangles(parse_point_list(&values, &ident)?),
        "SQ" => Property::Squares(parse_point_list(&values, &ident)?),
        "SL" => Property::SelectedPoints(parse_point_list(&values, &ident)?),
        "LB" => Property::Labels(parse_label_list(&values, &ident)?),
        "LN" => Property::Lines(parse_point_pair_list(&values, &ident)?),
        "DD" => Property::DimPoints(parse_point_list(&values, &ident)?),

        // -- Timing --
        "BL" => Property::BlackTime(parse_f64(&values, &ident)?),
        "WL" => Property::WhiteTime(parse_f64(&values, &ident)?),
        "OB" => Property::BlackOvertimePeriods(parse_u32(&values, &ident)?),
        "OW" => Property::WhiteOvertimePeriods(parse_u32(&values, &ident)?),

        // -- Misc --
        "FG" => parse_fg(&values)?,
        "PM" => Property::PrintMoveMode(parse_u32(&values, &ident)?),
        "VW" => Property::View(parse_point_list(&values, &ident)?),

        // -- Unknown --
        _ => Property::Unknown(ident, values),
    };
    Ok(prop)
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

fn one_value(values: &[String], _ident: &str) -> Result<String, SgfError> {
    Ok(values.first().cloned().unwrap_or_default())
}

fn parse_u8(values: &[String], ident: &str) -> Result<u8, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    s.trim()
        .parse::<u8>()
        .map_err(|_| SgfError::InvalidPropertyValue {
            property: ident.to_string(),
            value: s.to_string(),
            reason: "expected integer 0-255".to_string(),
        })
}

fn parse_u32(values: &[String], ident: &str) -> Result<u32, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    s.trim()
        .parse::<u32>()
        .map_err(|_| SgfError::InvalidPropertyValue {
            property: ident.to_string(),
            value: s.to_string(),
            reason: "expected non-negative integer".to_string(),
        })
}

fn parse_f64(values: &[String], ident: &str) -> Result<f64, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    s.trim()
        .parse::<f64>()
        .map_err(|_| SgfError::InvalidPropertyValue {
            property: ident.to_string(),
            value: s.to_string(),
            reason: "expected number".to_string(),
        })
}

fn parse_double(values: &[String], ident: &str) -> Result<Double, SgfError> {
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

fn parse_color(values: &[String], ident: &str) -> Result<Stone, SgfError> {
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
fn parse_sz(values: &[String]) -> Result<Property, SgfError> {
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
fn parse_ap(values: &[String]) -> Result<Property, SgfError> {
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
fn parse_fg(values: &[String]) -> Result<Property, SgfError> {
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
fn letter_to_coord(ch: char) -> Result<u8, SgfError> {
    match ch {
        'a'..='z' => Ok(ch as u8 - b'a'),
        'A'..='Z' => Ok(ch as u8 - b'A' + 26),
        _ => Err(SgfError::InvalidCoordinate(ch.to_string())),
    }
}

/// Parse a 2-char coordinate string like "cd" → (2, 3).
/// SGF coordinates are (column, row) with 'a' = 0.
fn parse_point(s: &str) -> Result<Point, SgfError> {
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
fn parse_move_point(values: &[String], _ident: &str) -> Result<Option<Point>, SgfError> {
    let s = values.first().map(|s| s.as_str()).unwrap_or("");
    if s.is_empty() {
        return Ok(None);
    }
    parse_point(s).map(Some)
}

/// Parse a list of points, with support for compressed point lists [aa:cc].
fn parse_point_list(values: &[String], _ident: &str) -> Result<Vec<Point>, SgfError> {
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
fn parse_point_pair_list(values: &[String], ident: &str) -> Result<Vec<PointPair>, SgfError> {
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
fn parse_label_list(values: &[String], ident: &str) -> Result<Vec<Label>, SgfError> {
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

/// Post-parse fixup: on boards ≤ 19×19 (or when SZ is absent, since the default is 19), convert B[tt]/W[tt] — parsed as (19,19) — into passes.
fn tt_fixup(game_tree: &mut GameTree) {
    let is_large_board = game_tree.nodes.iter().any(|n| {
        n.properties
            .iter()
            .any(|p| matches!(p, Property::BoardSize(c, r) if *c > 19 || *r > 19))
    });

    if !is_large_board {
        fixup_tt_moves(game_tree);
    }
}

fn fixup_tt_moves(tree: &mut GameTree) {
    for node in &mut tree.nodes {
        for prop in &mut node.properties {
            match prop {
                Property::Black(Some(pt)) if *pt == (19, 19) => *prop = Property::Black(None),
                Property::White(Some(pt)) if *pt == (19, 19) => *prop = Property::White(None),
                _ => {}
            }
        }
    }
    for variation in &mut tree.variations {
        fixup_tt_moves(variation);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_returns_error() {
        assert!(matches!(parse(""), Err(SgfError::EmptyCollection)));
    }

    #[test]
    fn parse_minimal_tree() {
        let coll = parse("(;)").unwrap();
        assert_eq!(coll.len(), 1);
        assert_eq!(coll[0].nodes.len(), 1);
        assert!(coll[0].nodes[0].properties.is_empty());
    }

    #[test]
    fn parse_root_properties() {
        let coll = parse("(;FF[4]GM[1]SZ[19])").unwrap();
        let props = &coll[0].nodes[0].properties;
        assert_eq!(props[0], Property::FileFormat(4));
        assert_eq!(props[1], Property::GameType(1));
        assert_eq!(props[2], Property::BoardSize(19, 19));
    }

    #[test]
    fn parse_rectangular_board() {
        let coll = parse("(;SZ[19:13])").unwrap();
        assert_eq!(coll[0].nodes[0].properties[0], Property::BoardSize(19, 13));
    }

    #[test]
    fn parse_move_sequence() {
        let coll = parse("(;B[cd];W[dc])").unwrap();
        assert_eq!(coll[0].nodes.len(), 2);
        assert_eq!(
            coll[0].nodes[0].properties[0],
            Property::Black(Some((2, 3)))
        );
        assert_eq!(
            coll[0].nodes[1].properties[0],
            Property::White(Some((3, 2)))
        );
    }

    #[test]
    fn parse_pass_move() {
        let coll = parse("(;B[])").unwrap();
        assert_eq!(coll[0].nodes[0].properties[0], Property::Black(None));

        let coll = parse("(;B[tt])").unwrap();
        assert_eq!(coll[0].nodes[0].properties[0], Property::Black(None));
    }

    #[test]
    fn tt_is_pass_on_small_board() {
        let coll = parse("(;SZ[19];B[tt])").unwrap();
        assert_eq!(coll[0].nodes[1].properties[0], Property::Black(None));
    }

    #[test]
    fn tt_is_coordinate_on_large_board() {
        let coll = parse("(;SZ[21];B[tt])").unwrap();
        assert_eq!(
            coll[0].nodes[1].properties[0],
            Property::Black(Some((19, 19)))
        );
    }

    #[test]
    fn tt_is_pass_when_no_sz() {
        // Default board size is 19×19
        let coll = parse("(;B[tt])").unwrap();
        assert_eq!(coll[0].nodes[0].properties[0], Property::Black(None));
    }

    #[test]
    fn tt_fixup_recurses_into_variations() {
        let coll = parse("(;SZ[19];B[aa](;W[tt])(;W[bb]))").unwrap();
        assert_eq!(
            coll[0].variations[0].nodes[0].properties[0],
            Property::White(None)
        );
    }

    #[test]
    fn parse_setup_stones() {
        let coll = parse("(;AB[aa][bb][cc])").unwrap();
        match &coll[0].nodes[0].properties[0] {
            Property::AddBlack(pts) => {
                assert_eq!(pts, &[(0, 0), (1, 1), (2, 2)]);
            }
            other => panic!("expected AB, got {other:?}"),
        }
    }

    #[test]
    fn parse_compressed_point_list() {
        let coll = parse("(;AB[aa:cc])").unwrap();
        match &coll[0].nodes[0].properties[0] {
            Property::AddBlack(pts) => {
                // 3×3 rectangle: (0,0)..(2,2)
                assert_eq!(pts.len(), 9);
                assert!(pts.contains(&(0, 0)));
                assert!(pts.contains(&(2, 2)));
                assert!(pts.contains(&(1, 1)));
            }
            other => panic!("expected AB, got {other:?}"),
        }
    }

    #[test]
    fn parse_variations() {
        let coll = parse("(;B[aa](;W[bb])(;W[cc]))").unwrap();
        assert_eq!(coll[0].nodes.len(), 1);
        assert_eq!(coll[0].variations.len(), 2);
        assert_eq!(
            coll[0].variations[0].nodes[0].properties[0],
            Property::White(Some((1, 1)))
        );
        assert_eq!(
            coll[0].variations[1].nodes[0].properties[0],
            Property::White(Some((2, 2)))
        );
    }

    #[test]
    fn parse_escaped_bracket_in_comment() {
        let coll = parse(r"(;C[hello \] world])").unwrap();
        assert_eq!(
            coll[0].nodes[0].properties[0],
            Property::Comment("hello ] world".to_string())
        );
    }

    #[test]
    fn parse_soft_linebreak() {
        let coll = parse("(;C[hello \\\nworld])").unwrap();
        assert_eq!(
            coll[0].nodes[0].properties[0],
            Property::Comment("hello world".to_string())
        );
    }

    #[test]
    fn parse_whitespace_between_elements() {
        let coll = parse("  (  ; FF[4]  GM[1] )  ").unwrap();
        assert_eq!(coll.len(), 1);
        assert_eq!(coll[0].nodes[0].properties.len(), 2);
    }

    #[test]
    fn parse_komi() {
        let coll = parse("(;KM[6.5])").unwrap();
        assert_eq!(coll[0].nodes[0].properties[0], Property::Komi(6.5));
    }

    #[test]
    fn parse_labels() {
        let coll = parse("(;LB[aa:1][bb:2])").unwrap();
        match &coll[0].nodes[0].properties[0] {
            Property::Labels(labels) => {
                assert_eq!(labels.len(), 2);
                assert_eq!(labels[0].point, (0, 0));
                assert_eq!(labels[0].text, "1");
                assert_eq!(labels[1].point, (1, 1));
                assert_eq!(labels[1].text, "2");
            }
            other => panic!("expected LB, got {other:?}"),
        }
    }

    #[test]
    fn parse_arrows() {
        let coll = parse("(;AR[aa:bb])").unwrap();
        match &coll[0].nodes[0].properties[0] {
            Property::Arrows(pairs) => {
                assert_eq!(pairs.len(), 1);
                assert_eq!(pairs[0].from, (0, 0));
                assert_eq!(pairs[0].to, (1, 1));
            }
            other => panic!("expected AR, got {other:?}"),
        }
    }

    #[test]
    fn parse_unknown_property() {
        let coll = parse("(;XX[hello][world])").unwrap();
        match &coll[0].nodes[0].properties[0] {
            Property::Unknown(id, vals) => {
                assert_eq!(id, "XX");
                assert_eq!(vals, &["hello", "world"]);
            }
            other => panic!("expected Unknown, got {other:?}"),
        }
    }

    #[test]
    fn parse_multiple_trees() {
        let coll = parse("(;FF[4])(;FF[4])").unwrap();
        assert_eq!(coll.len(), 2);
    }

    #[test]
    fn parse_application() {
        let coll = parse("(;AP[CGoban:3])").unwrap();
        assert_eq!(
            coll[0].nodes[0].properties[0],
            Property::ApplicationNameVersion("CGoban".to_string(), "3".to_string())
        );
    }

    #[test]
    fn parse_figure() {
        let coll = parse("(;FG[257:Figure 1])").unwrap();
        assert_eq!(
            coll[0].nodes[0].properties[0],
            Property::Figure(Some((257, "Figure 1".to_string())))
        );

        let coll = parse("(;FG[])").unwrap();
        assert_eq!(coll[0].nodes[0].properties[0], Property::Figure(None));
    }

    #[test]
    fn parse_player_to_play() {
        let coll = parse("(;PL[B])").unwrap();
        assert_eq!(
            coll[0].nodes[0].properties[0],
            Property::PlayerToPlay(Stone::Black)
        );
    }

    #[test]
    fn parse_double_annotation() {
        let coll = parse("(;GB[2])").unwrap();
        assert_eq!(
            coll[0].nodes[0].properties[0],
            Property::GoodForBlack(Double::Emphasized)
        );
    }

    #[test]
    fn coordinate_a_is_0() {
        assert_eq!(letter_to_coord('a').unwrap(), 0);
        assert_eq!(letter_to_coord('s').unwrap(), 18);
        assert_eq!(letter_to_coord('z').unwrap(), 25);
        assert_eq!(letter_to_coord('A').unwrap(), 26);
    }
}
