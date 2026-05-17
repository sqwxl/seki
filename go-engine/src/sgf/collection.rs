use super::error::SgfError;
use super::game_tree::convert_property;
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
    use crate::Stone;

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
}
