use crate::Stone;

use super::types::*;

/// Serialize a Collection back to an SGF string.
pub fn serialize(collection: &Collection) -> String {
    let mut buf = String::new();
    for tree in collection {
        write_game_tree(tree, &mut buf);
    }
    buf
}

fn write_game_tree(tree: &GameTree, buf: &mut String) {
    buf.push('(');
    for node in &tree.nodes {
        write_node(node, buf);
    }
    for variation in &tree.variations {
        write_game_tree(variation, buf);
    }
    buf.push(')');
}

fn write_node(node: &Node, buf: &mut String) {
    buf.push(';');
    for prop in &node.properties {
        write_property(prop, buf);
    }
}

fn write_property(prop: &Property, buf: &mut String) {
    match prop {
        // -- Move --
        Property::Black(p) => write_move("B", p, buf),
        Property::White(p) => write_move("W", p, buf),
        Property::Ko => write_empty("KO", buf),
        Property::MoveNumber(n) => write_number("MN", *n, buf),

        // -- Setup --
        Property::AddBlack(pts) => write_point_list("AB", pts, buf),
        Property::AddWhite(pts) => write_point_list("AW", pts, buf),
        Property::AddEmpty(pts) => write_point_list("AE", pts, buf),
        Property::PlayerToPlay(c) => {
            buf.push_str("PL[");
            buf.push(match c {
                Stone::Black => 'B',
                Stone::White => 'W',
            });
            buf.push(']');
        }

        // -- Root --
        Property::FileFormat(n) => write_number("FF", *n, buf),
        Property::GameType(n) => write_number("GM", *n, buf),
        Property::BoardSize(cols, rows) => {
            if cols == rows {
                write_number("SZ", *cols, buf);
            } else {
                buf.push_str("SZ[");
                buf.push_str(&cols.to_string());
                buf.push(':');
                buf.push_str(&rows.to_string());
                buf.push(']');
            }
        }
        Property::ApplicationNameVersion(name, version) => {
            buf.push_str("AP[");
            push_escaped(buf, name);
            if !version.is_empty() {
                buf.push(':');
                push_escaped(buf, version);
            }
            buf.push(']');
        }
        Property::CharacterSet(s) => write_simple_text("CA", s, buf),
        Property::Style(n) => write_number("ST", *n, buf),

        // -- Game info --
        Property::BlackName(s) => write_simple_text("PB", s, buf),
        Property::WhiteName(s) => write_simple_text("PW", s, buf),
        Property::BlackRank(s) => write_simple_text("BR", s, buf),
        Property::WhiteRank(s) => write_simple_text("WR", s, buf),
        Property::BlackTeam(s) => write_simple_text("BT", s, buf),
        Property::WhiteTeam(s) => write_simple_text("WT", s, buf),
        Property::EventName(s) => write_simple_text("EV", s, buf),
        Property::Round(s) => write_simple_text("RO", s, buf),
        Property::Date(s) => write_simple_text("DT", s, buf),
        Property::Place(s) => write_simple_text("PC", s, buf),
        Property::Rules(s) => write_simple_text("RU", s, buf),
        Property::Result(s) => write_simple_text("RE", s, buf),
        Property::TimeLimitSeconds(n) => write_real("TM", *n, buf),
        Property::OvertimeDescription(s) => write_simple_text("OT", s, buf),
        Property::GameName(s) => write_simple_text("GN", s, buf),
        Property::GameComment(s) => write_text("GC", s, buf),
        Property::Opening(s) => write_simple_text("ON", s, buf),
        Property::Source(s) => write_simple_text("SO", s, buf),
        Property::Copyright(s) => write_simple_text("CP", s, buf),
        Property::User(s) => write_simple_text("US", s, buf),
        Property::Annotator(s) => write_simple_text("AN", s, buf),

        // -- Go-specific --
        Property::Handicap(n) => write_number("HA", *n, buf),
        Property::Komi(n) => write_real("KM", *n, buf),
        Property::TerritoryBlack(pts) => write_point_list("TB", pts, buf),
        Property::TerritoryWhite(pts) => write_point_list("TW", pts, buf),

        // -- Annotation --
        Property::Comment(s) => write_text("C", s, buf),
        Property::NodeName(s) => write_simple_text("N", s, buf),
        Property::NodeValue(n) => write_real("V", *n, buf),
        Property::EvenPosition(d) => write_double("DM", *d, buf),
        Property::GoodForBlack(d) => write_double("GB", *d, buf),
        Property::GoodForWhite(d) => write_double("GW", *d, buf),
        Property::UnclearPosition(d) => write_double("UC", *d, buf),
        Property::Hotspot(d) => write_double("HO", *d, buf),

        // -- Move annotation --
        Property::BadMove(d) => write_double("BM", *d, buf),
        Property::Tesuji(d) => write_double("TE", *d, buf),
        Property::DoubtfulMove => write_empty("DO", buf),
        Property::InterestingMove => write_empty("IT", buf),

        // -- Markup --
        Property::Arrows(pairs) => write_point_pair_list("AR", pairs, buf),
        Property::Circles(pts) => write_point_list("CR", pts, buf),
        Property::XMarks(pts) => write_point_list("MA", pts, buf),
        Property::Triangles(pts) => write_point_list("TR", pts, buf),
        Property::Squares(pts) => write_point_list("SQ", pts, buf),
        Property::SelectedPoints(pts) => write_point_list("SL", pts, buf),
        Property::Labels(labels) => write_label_list("LB", labels, buf),
        Property::Lines(pairs) => write_point_pair_list("LN", pairs, buf),
        Property::DimPoints(pts) => write_point_list("DD", pts, buf),

        // -- Timing --
        Property::BlackTime(n) => write_real("BL", *n, buf),
        Property::WhiteTime(n) => write_real("WL", *n, buf),
        Property::BlackOvertimePeriods(n) => write_number("OB", *n, buf),
        Property::WhiteOvertimePeriods(n) => write_number("OW", *n, buf),

        // -- Misc --
        Property::Figure(opt) => match opt {
            None => write_empty_value("FG", buf),
            Some((flags, name)) => {
                buf.push_str("FG[");
                buf.push_str(&flags.to_string());
                if !name.is_empty() {
                    buf.push(':');
                    push_escaped(buf, name);
                }
                buf.push(']');
            }
        },
        Property::PrintMoveMode(n) => write_number("PM", *n, buf),
        Property::View(pts) => {
            if pts.is_empty() {
                write_empty_value("VW", buf);
            } else {
                write_point_list("VW", pts, buf);
            }
        }

        // -- Unknown --
        Property::Unknown(ident, values) => {
            buf.push_str(ident);
            for val in values {
                buf.push('[');
                push_escaped(buf, val);
                buf.push(']');
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn coord_to_letter(c: u8) -> char {
    if c < 26 {
        (b'a' + c) as char
    } else {
        (b'A' + c - 26) as char
    }
}

fn push_point(buf: &mut String, point: crate::Point) {
    buf.push(coord_to_letter(point.0));
    buf.push(coord_to_letter(point.1));
}

fn push_escaped(buf: &mut String, s: &str) {
    for ch in s.chars() {
        match ch {
            ']' | '\\' => {
                buf.push('\\');
                buf.push(ch);
            }
            _ => buf.push(ch),
        }
    }
}

fn write_empty(ident: &str, buf: &mut String) {
    buf.push_str(ident);
    buf.push_str("[]");
}

fn write_empty_value(ident: &str, buf: &mut String) {
    buf.push_str(ident);
    buf.push_str("[]");
}

fn write_number(ident: &str, n: impl std::fmt::Display, buf: &mut String) {
    buf.push_str(ident);
    buf.push('[');
    buf.push_str(&n.to_string());
    buf.push(']');
}

fn write_real(ident: &str, n: f64, buf: &mut String) {
    buf.push_str(ident);
    buf.push('[');
    // Emit integer form when possible (6.0 → "6", 6.5 → "6.5")
    if n.fract() == 0.0 {
        buf.push_str(&(n as i64).to_string());
    } else {
        buf.push_str(&n.to_string());
    }
    buf.push(']');
}

fn write_simple_text(ident: &str, s: &str, buf: &mut String) {
    buf.push_str(ident);
    buf.push('[');
    push_escaped(buf, s);
    buf.push(']');
}

fn write_text(ident: &str, s: &str, buf: &mut String) {
    buf.push_str(ident);
    buf.push('[');
    push_escaped(buf, s);
    buf.push(']');
}

fn write_double(ident: &str, d: Double, buf: &mut String) {
    buf.push_str(ident);
    buf.push('[');
    buf.push_str(match d {
        Double::Normal => "1",
        Double::Emphasized => "2",
    });
    buf.push(']');
}

fn write_move(ident: &str, point: &Option<crate::Point>, buf: &mut String) {
    buf.push_str(ident);
    buf.push('[');
    if let Some(p) = point {
        push_point(buf, *p);
    }
    buf.push(']');
}

fn write_point_list(ident: &str, points: &[crate::Point], buf: &mut String) {
    buf.push_str(ident);
    for p in points {
        buf.push('[');
        push_point(buf, *p);
        buf.push(']');
    }
}

fn write_point_pair_list(ident: &str, pairs: &[PointPair], buf: &mut String) {
    buf.push_str(ident);
    for pair in pairs {
        buf.push('[');
        push_point(buf, pair.from);
        buf.push(':');
        push_point(buf, pair.to);
        buf.push(']');
    }
}

fn write_label_list(ident: &str, labels: &[Label], buf: &mut String) {
    buf.push_str(ident);
    for label in labels {
        buf.push('[');
        push_point(buf, label.point);
        buf.push(':');
        push_escaped(buf, &label.text);
        buf.push(']');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialize_minimal() {
        let coll = vec![GameTree {
            nodes: vec![Node { properties: vec![] }],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), "(;)");
    }

    #[test]
    fn serialize_root_node() {
        let coll = vec![GameTree {
            nodes: vec![Node {
                properties: vec![
                    Property::FileFormat(4),
                    Property::GameType(1),
                    Property::BoardSize(19, 19),
                ],
            }],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), "(;FF[4]GM[1]SZ[19])");
    }

    #[test]
    fn serialize_rectangular_board() {
        let coll = vec![GameTree {
            nodes: vec![Node {
                properties: vec![Property::BoardSize(19, 13)],
            }],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), "(;SZ[19:13])");
    }

    #[test]
    fn serialize_moves() {
        let coll = vec![GameTree {
            nodes: vec![
                Node {
                    properties: vec![Property::Black(Some((2, 3)))],
                },
                Node {
                    properties: vec![Property::White(Some((3, 2)))],
                },
            ],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), "(;B[cd];W[dc])");
    }

    #[test]
    fn serialize_pass() {
        let coll = vec![GameTree {
            nodes: vec![Node {
                properties: vec![Property::Black(None)],
            }],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), "(;B[])");
    }

    #[test]
    fn serialize_escape_bracket() {
        let coll = vec![GameTree {
            nodes: vec![Node {
                properties: vec![Property::Comment("hello ] world".to_string())],
            }],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), r"(;C[hello \] world])");
    }

    #[test]
    fn serialize_komi() {
        let coll = vec![GameTree {
            nodes: vec![Node {
                properties: vec![Property::Komi(6.5)],
            }],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), "(;KM[6.5])");
    }

    #[test]
    fn serialize_integer_komi() {
        let coll = vec![GameTree {
            nodes: vec![Node {
                properties: vec![Property::Komi(0.0)],
            }],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), "(;KM[0])");
    }

    #[test]
    fn serialize_variations() {
        let coll = vec![GameTree {
            nodes: vec![Node {
                properties: vec![Property::Black(Some((0, 0)))],
            }],
            variations: vec![
                GameTree {
                    nodes: vec![Node {
                        properties: vec![Property::White(Some((1, 1)))],
                    }],
                    variations: vec![],
                },
                GameTree {
                    nodes: vec![Node {
                        properties: vec![Property::White(Some((2, 2)))],
                    }],
                    variations: vec![],
                },
            ],
        }];
        assert_eq!(serialize(&coll), "(;B[aa](;W[bb])(;W[cc]))");
    }

    #[test]
    fn serialize_unknown_property() {
        let coll = vec![GameTree {
            nodes: vec![Node {
                properties: vec![Property::Unknown(
                    "XX".to_string(),
                    vec!["hello".to_string(), "world".to_string()],
                )],
            }],
            variations: vec![],
        }];
        assert_eq!(serialize(&coll), "(;XX[hello][world])");
    }
}
