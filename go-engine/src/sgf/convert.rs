use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::game_tree::{GameTree, NodeId};
use crate::stone::Stone;
use crate::turn::Turn;

use super::types::{self as sgf, Property};

/// Per-move time data extracted from SGF BL/WL/OB/OW properties.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MoveTime {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub black_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub black_periods: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white_periods: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SgfMetadata {
    pub cols: u8,
    pub rows: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub komi: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handicap: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub black_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub white_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_limit_secs: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overtime: Option<String>,
}

/// Extract metadata from the root node of an SGF game tree.
fn extract_metadata(sgf_tree: &sgf::GameTree) -> SgfMetadata {
    let mut meta = SgfMetadata {
        cols: 19,
        rows: 19,
        ..Default::default()
    };

    if let Some(root) = sgf_tree.nodes.first() {
        for prop in &root.properties {
            match prop {
                Property::BoardSize(c, r) => {
                    meta.cols = *c;
                    meta.rows = *r;
                }
                Property::Komi(k) => meta.komi = Some(*k),
                Property::Handicap(h) => meta.handicap = Some(*h),
                Property::BlackName(s) => meta.black_name = Some(s.clone()),
                Property::WhiteName(s) => meta.white_name = Some(s.clone()),
                Property::GameName(s) => meta.game_name = Some(s.clone()),
                Property::Result(s) => meta.result = Some(s.clone()),
                Property::TimeLimitSeconds(t) => meta.time_limit_secs = Some(*t),
                Property::OvertimeDescription(s) => meta.overtime = Some(s.clone()),
                _ => {}
            }
        }
    }

    meta
}

/// Extract a Turn from an SGF node's properties, if it contains a move.
fn node_to_turn(node: &sgf::Node) -> Option<Turn> {
    for prop in &node.properties {
        match prop {
            Property::Black(Some(pt)) => return Some(Turn::play(Stone::Black, *pt)),
            Property::Black(None) => return Some(Turn::pass(Stone::Black)),
            Property::White(Some(pt)) => return Some(Turn::play(Stone::White, *pt)),
            Property::White(None) => return Some(Turn::pass(Stone::White)),
            _ => {}
        }
    }
    None
}

/// Extract per-move time data from an SGF node's properties.
fn node_to_move_time(node: &sgf::Node) -> Option<MoveTime> {
    let mut mt = MoveTime::default();
    let mut found = false;
    for prop in &node.properties {
        match prop {
            Property::BlackTime(t) => {
                mt.black_time = Some(*t);
                found = true;
            }
            Property::WhiteTime(t) => {
                mt.white_time = Some(*t);
                found = true;
            }
            Property::BlackOvertimePeriods(p) => {
                mt.black_periods = Some(*p);
                found = true;
            }
            Property::WhiteOvertimePeriods(p) => {
                mt.white_periods = Some(*p);
                found = true;
            }
            _ => {}
        }
    }
    if found { Some(mt) } else { None }
}

/// Result of converting an SGF tree.
pub struct SgfConversion {
    pub tree: GameTree,
    pub metadata: SgfMetadata,
    pub move_times: HashMap<NodeId, MoveTime>,
}

/// Convert an SGF game tree into an engine GameTree + metadata + per-move times.
///
/// Walks the SGF tree recursively, extracting B/W move properties as Turns.
/// Non-move nodes (root properties, comments, etc.) are skipped.
pub fn sgf_to_game_tree(sgf_tree: &sgf::GameTree) -> SgfConversion {
    let metadata = extract_metadata(sgf_tree);
    let mut tree = GameTree::new();
    let mut move_times = HashMap::new();

    walk_sgf_sequence(sgf_tree, &mut tree, None, &mut move_times);

    SgfConversion {
        tree,
        metadata,
        move_times,
    }
}

/// Walk an SGF GameTree's node sequence, adding turns to the engine tree.
/// Returns the last NodeId added (or the parent if no moves were added).
fn walk_sgf_sequence(
    sgf_tree: &sgf::GameTree,
    tree: &mut GameTree,
    parent: Option<NodeId>,
    move_times: &mut HashMap<NodeId, MoveTime>,
) -> Option<NodeId> {
    let mut current = parent;

    // Process sequential nodes
    for node in &sgf_tree.nodes {
        if let Some(turn) = node_to_turn(node) {
            let id = tree.add_child(current, turn);
            if let Some(mt) = node_to_move_time(node) {
                move_times.insert(id, mt);
            }
            current = Some(id);
        }
    }

    // Process variations: each is a sub-GameTree branching from `current`
    for variation in &sgf_tree.variations {
        walk_sgf_sequence(variation, tree, current, move_times);
    }

    current
}

/// Convert an engine GameTree + metadata into an SGF game tree string.
pub fn game_tree_to_sgf(tree: &GameTree, meta: &SgfMetadata) -> String {
    let sgf_tree = build_sgf_tree(tree, meta);
    super::serialize::serialize(&vec![sgf_tree])
}

/// Build an sgf::GameTree from an engine GameTree.
fn build_sgf_tree(tree: &GameTree, meta: &SgfMetadata) -> sgf::GameTree {
    // Root node with metadata properties
    let mut root_props = vec![
        Property::FileFormat(4),
        Property::GameType(1),
        Property::BoardSize(meta.cols, meta.rows),
    ];
    if let Some(k) = meta.komi {
        root_props.push(Property::Komi(k));
    }
    if let Some(h) = meta.handicap
        && h >= 2
    {
        root_props.push(Property::Handicap(h));
    }
    if let Some(ref s) = meta.black_name {
        root_props.push(Property::BlackName(s.clone()));
    }
    if let Some(ref s) = meta.white_name {
        root_props.push(Property::WhiteName(s.clone()));
    }
    if let Some(ref s) = meta.game_name {
        root_props.push(Property::GameName(s.clone()));
    }
    if let Some(ref s) = meta.result {
        root_props.push(Property::Result(s.clone()));
    }
    if let Some(t) = meta.time_limit_secs {
        root_props.push(Property::TimeLimitSeconds(t));
    }
    if let Some(ref s) = meta.overtime {
        root_props.push(Property::OvertimeDescription(s.clone()));
    }

    let root_node = sgf::Node {
        properties: root_props,
    };

    let root_children = tree.root_children();
    if root_children.is_empty() {
        return sgf::GameTree {
            nodes: vec![root_node],
            variations: vec![],
        };
    }

    // Build the main line from the first root child
    let (mut nodes, variations) = build_sgf_line(tree, root_children[0]);
    nodes.insert(0, root_node);

    // Additional root children become variations
    let mut all_variations = variations;
    for &child_id in &root_children[1..] {
        let (var_nodes, var_variations) = build_sgf_line(tree, child_id);
        all_variations.push(sgf::GameTree {
            nodes: var_nodes,
            variations: var_variations,
        });
    }

    sgf::GameTree {
        nodes,
        variations: all_variations,
    }
}

/// Build a line of SGF nodes from a starting engine node, following children[0].
/// Returns (nodes_in_sequence, variations_at_end).
fn build_sgf_line(tree: &GameTree, start: NodeId) -> (Vec<sgf::Node>, Vec<sgf::GameTree>) {
    let mut nodes = Vec::new();
    let mut current = start;

    loop {
        let node = tree.node(current);
        let sgf_node = turn_to_sgf_node(&node.turn);
        nodes.push(sgf_node);

        let children = tree.children_of(Some(current));
        match children.len() {
            0 => return (nodes, vec![]),
            1 => {
                current = children[0];
            }
            _ => {
                // Multiple children: first continues the sequence, rest are variations
                let mut variations = Vec::new();
                for &child_id in &children[1..] {
                    let (var_nodes, var_vars) = build_sgf_line(tree, child_id);
                    variations.push(sgf::GameTree {
                        nodes: var_nodes,
                        variations: var_vars,
                    });
                }

                // Continue with first child
                current = children[0];
                // But we need to wrap the continuation + variations
                let (rest_nodes, rest_vars) = build_sgf_line(tree, current);

                // The continuation becomes its own sub-tree alongside the other variations
                let main_continuation = sgf::GameTree {
                    nodes: rest_nodes,
                    variations: rest_vars,
                };

                // All children become variations
                let mut all_variations = vec![main_continuation];
                all_variations.extend(variations);

                return (nodes, all_variations);
            }
        }
    }
}

/// Convert a Turn into an SGF Node.
fn turn_to_sgf_node(turn: &Turn) -> sgf::Node {
    let prop = match (turn.stone, turn.pos) {
        (Stone::Black, Some(pt)) => Property::Black(Some(pt)),
        (Stone::Black, None) => Property::Black(None),
        (Stone::White, Some(pt)) => Property::White(Some(pt)),
        (Stone::White, None) => Property::White(None),
    };
    sgf::Node {
        properties: vec![prop],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sgf;

    #[test]
    fn linear_game_round_trip() {
        let input = "(;FF[4]GM[1]SZ[19]KM[6.5];B[pd];W[dd];B[pp];W[dp])";
        let collection = sgf::parse(input).unwrap();
        let conv = sgf_to_game_tree(&collection[0]);

        assert_eq!(conv.metadata.cols, 19);
        assert_eq!(conv.metadata.rows, 19);
        assert_eq!(conv.metadata.komi, Some(6.5));
        assert_eq!(conv.tree.len(), 4);

        // Export and verify
        let output = game_tree_to_sgf(&conv.tree, &conv.metadata);
        // Re-parse and check same moves
        let re_collection = sgf::parse(&output).unwrap();
        let re = sgf_to_game_tree(&re_collection[0]);
        assert_eq!(re.tree.len(), conv.tree.len());
        assert_eq!(re.metadata.cols, conv.metadata.cols);
        assert_eq!(re.metadata.komi, conv.metadata.komi);
    }

    #[test]
    fn variations_round_trip() {
        let input = "(;FF[4]GM[1]SZ[9];B[ee](;W[ge];B[dg])(;W[de];B[fg]))";
        let collection = sgf::parse(input).unwrap();
        let conv = sgf_to_game_tree(&collection[0]);

        assert_eq!(conv.metadata.cols, 9);
        // 1 root + 2 branches of 2 = 5 nodes
        assert_eq!(conv.tree.len(), 5);
        assert_eq!(conv.tree.root_children().len(), 1);

        let root = conv.tree.root_children()[0];
        assert_eq!(conv.tree.children_of(Some(root)).len(), 2);

        // Export and verify structure survives
        let output = game_tree_to_sgf(&conv.tree, &conv.metadata);
        let re_collection = sgf::parse(&output).unwrap();
        let re = sgf_to_game_tree(&re_collection[0]);
        assert_eq!(re.tree.len(), 5);
        let re_root = re.tree.root_children()[0];
        assert_eq!(re.tree.children_of(Some(re_root)).len(), 2);
    }

    #[test]
    fn metadata_extraction() {
        let input = "(;FF[4]GM[1]SZ[13]KM[0.5]HA[2]PB[Alice]PW[Bob]GN[Test]RE[B+2.5]TM[1800]OT[5x30 byo-yomi])";
        let collection = sgf::parse(input).unwrap();
        let conv = sgf_to_game_tree(&collection[0]);
        let meta = &conv.metadata;

        assert_eq!(meta.cols, 13);
        assert_eq!(meta.rows, 13);
        assert_eq!(meta.komi, Some(0.5));
        assert_eq!(meta.handicap, Some(2));
        assert_eq!(meta.black_name.as_deref(), Some("Alice"));
        assert_eq!(meta.white_name.as_deref(), Some("Bob"));
        assert_eq!(meta.game_name.as_deref(), Some("Test"));
        assert_eq!(meta.result.as_deref(), Some("B+2.5"));
        assert_eq!(meta.time_limit_secs, Some(1800.0));
        assert_eq!(meta.overtime.as_deref(), Some("5x30 byo-yomi"));
    }

    #[test]
    fn pass_moves() {
        let input = "(;FF[4]GM[1]SZ[19];B[dd];W[];B[])";
        let collection = sgf::parse(input).unwrap();
        let conv = sgf_to_game_tree(&collection[0]);

        assert_eq!(conv.tree.len(), 3);
        let moves = conv.tree.moves_to(2);
        assert!(moves[0].is_play());
        assert!(moves[1].is_pass());
        assert!(moves[2].is_pass());

        // Export and verify passes survive
        let meta = SgfMetadata {
            cols: 19,
            rows: 19,
            ..Default::default()
        };
        let output = game_tree_to_sgf(&conv.tree, &meta);
        assert!(output.contains("W[]"));
        assert!(output.contains("B[]"));
    }

    #[test]
    fn default_19x19_when_sz_absent() {
        let input = "(;FF[4]GM[1];B[pd])";
        let collection = sgf::parse(input).unwrap();
        let conv = sgf_to_game_tree(&collection[0]);

        assert_eq!(conv.metadata.cols, 19);
        assert_eq!(conv.metadata.rows, 19);
    }

    #[test]
    fn empty_tree_export() {
        let tree = GameTree::new();
        let meta = SgfMetadata {
            cols: 9,
            rows: 9,
            ..Default::default()
        };
        let output = game_tree_to_sgf(&tree, &meta);

        assert!(output.contains("SZ[9]"));
        let re_collection = sgf::parse(&output).unwrap();
        let re = sgf_to_game_tree(&re_collection[0]);
        assert!(re.tree.is_empty());
    }

    #[test]
    fn metadata_round_trip() {
        let meta = SgfMetadata {
            cols: 19,
            rows: 19,
            komi: Some(6.5),
            handicap: Some(3),
            black_name: Some("Alice".into()),
            white_name: Some("Bob".into()),
            game_name: Some("Game 1".into()),
            result: Some("W+R".into()),
            time_limit_secs: Some(1800.0),
            overtime: Some("5x30 byo-yomi".into()),
        };
        let tree = GameTree::new();
        let output = game_tree_to_sgf(&tree, &meta);
        let re_collection = sgf::parse(&output).unwrap();
        let re = sgf_to_game_tree(&re_collection[0]);

        assert_eq!(re.metadata.komi, meta.komi);
        assert_eq!(re.metadata.handicap, meta.handicap);
        assert_eq!(re.metadata.black_name, meta.black_name);
        assert_eq!(re.metadata.white_name, meta.white_name);
        assert_eq!(re.metadata.game_name, meta.game_name);
        assert_eq!(re.metadata.result, meta.result);
        assert_eq!(re.metadata.time_limit_secs, meta.time_limit_secs);
        assert_eq!(re.metadata.overtime, meta.overtime);
    }

    #[test]
    fn nested_variations() {
        // Main: B[ee] W[ge] B[dg]
        // Var at W: W[de] B[fg]
        let input = "(;FF[4]GM[1]SZ[9];B[ee];W[ge](;B[dg])(;B[fg]))";
        let collection = sgf::parse(input).unwrap();
        let conv = sgf_to_game_tree(&collection[0]);

        // 1(B[ee]) -> 2(W[ge]) -> 3(B[dg]) + 4(B[fg])
        assert_eq!(conv.tree.len(), 4);
        let root = conv.tree.root_children()[0];
        let second = conv.tree.children_of(Some(root))[0];
        assert_eq!(conv.tree.children_of(Some(second)).len(), 2);
    }

    #[test]
    fn per_move_time_extraction() {
        let input = "(;FF[4]GM[1]SZ[19]TM[600];B[pd]BL[590.5];W[dd]WL[585]OW[3];B[pp]BL[580])";
        let collection = sgf::parse(input).unwrap();
        let conv = sgf_to_game_tree(&collection[0]);

        assert_eq!(conv.metadata.time_limit_secs, Some(600.0));
        assert_eq!(conv.tree.len(), 3);
        assert_eq!(conv.move_times.len(), 3);

        // Node 0: B[pd] BL[590.5]
        let mt0 = &conv.move_times[&0];
        assert_eq!(mt0.black_time, Some(590.5));
        assert_eq!(mt0.white_time, None);

        // Node 1: W[dd] WL[585] OW[3]
        let mt1 = &conv.move_times[&1];
        assert_eq!(mt1.white_time, Some(585.0));
        assert_eq!(mt1.white_periods, Some(3));
        assert_eq!(mt1.black_time, None);

        // Node 2: B[pp] BL[580]
        let mt2 = &conv.move_times[&2];
        assert_eq!(mt2.black_time, Some(580.0));
    }
}
