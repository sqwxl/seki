use crate::Point;
use crate::engine::Engine;
use crate::game_tree::{GameTree, NodeId};
use crate::turn::Turn;

/// Engine wrapper with a game tree and a navigation cursor.
///
/// Maintains a `GameTree` of moves and a `current` node pointer
/// (None = root / empty board). The inner `Engine` is always rebuilt
/// to match the current position.
#[derive(Debug, Clone)]
pub struct Replay {
    cols: u8,
    rows: u8,
    tree: GameTree,
    current: Option<NodeId>,
    engine: Engine,
    /// Remembered navigation path (root-first sequence of NodeIds).
    /// `forward()` follows this path when possible, falling back to children[0].
    path: Vec<NodeId>,
}

impl Replay {
    pub fn new(cols: u8, rows: u8) -> Self {
        Self {
            cols,
            rows,
            tree: GameTree::new(),
            current: None,
            engine: Engine::new(cols, rows),
            path: Vec::new(),
        }
    }

    pub fn with_moves(cols: u8, rows: u8, moves: Vec<Turn>) -> Self {
        let tree = GameTree::from_moves(&moves);
        let path = Self::main_line_path(&tree);
        let current = path.last().copied();
        let engine = Engine::with_moves(cols, rows, moves);
        Self {
            cols,
            rows,
            tree,
            current,
            engine,
            path,
        }
    }

    fn rebuild(&mut self) {
        let moves = match self.current {
            Some(id) => self.tree.moves_to(id),
            None => Vec::new(),
        };
        self.engine = Engine::with_moves(self.cols, self.rows, moves);
    }

    /// Build the main-line path (following children[0] from root to leaf).
    fn main_line_path(tree: &GameTree) -> Vec<NodeId> {
        let roots = tree.root_children();
        if roots.is_empty() {
            return Vec::new();
        }
        let mut path = vec![roots[0]];
        loop {
            let children = tree.children_of(Some(*path.last().unwrap()));
            if children.is_empty() {
                return path;
            }
            path.push(children[0]);
        }
    }

    /// Follow the remembered path from current to a leaf.
    /// Falls back to children[0] when path doesn't cover a node.
    fn leaf_from_current(&self) -> Option<NodeId> {
        let mut current = self.current;
        let mut depth = self.view_index();
        loop {
            let children = self.tree.children_of(current);
            if children.is_empty() {
                return current;
            }
            let next = if depth < self.path.len() && children.contains(&self.path[depth]) {
                self.path[depth]
            } else {
                children[0]
            };
            current = Some(next);
            depth += 1;
        }
    }

    /// Depth of a node (number of moves from root).
    fn depth_of(&self, node_id: NodeId) -> usize {
        self.tree.path_to(node_id).len()
    }

    // -- Accessors --

    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    pub fn tree(&self) -> &GameTree {
        &self.tree
    }

    pub fn current_node(&self) -> Option<NodeId> {
        self.current
    }

    /// Flat moves along the path from root to current node.
    pub fn moves(&self) -> Vec<Turn> {
        match self.current {
            Some(id) => self.tree.moves_to(id),
            None => Vec::new(),
        }
    }

    /// Depth of current node (0 = root/empty board).
    pub fn view_index(&self) -> usize {
        match self.current {
            Some(id) => self.depth_of(id),
            None => 0,
        }
    }

    /// Total depth following first children from current to leaf.
    pub fn total_moves(&self) -> usize {
        match self.leaf_from_current() {
            Some(leaf) => self.depth_of(leaf),
            None => self.view_index(),
        }
    }

    pub fn is_at_latest(&self) -> bool {
        match self.current {
            Some(id) => self.tree.children_of(Some(id)).is_empty(),
            None => self.tree.root_children().is_empty(),
        }
    }

    pub fn is_at_start(&self) -> bool {
        self.current.is_none()
    }

    /// The turn at the current position, if any.
    pub fn last_move(&self) -> Option<&Turn> {
        self.current.map(|id| &self.tree.node(id).turn)
    }

    /// The position of the last played stone at the current view, if any.
    pub fn last_play_pos(&self) -> Option<Point> {
        self.last_move().filter(|t| t.is_play()).and_then(|t| t.pos)
    }

    // -- Game actions --

    /// Play the current turn's stone at the given point.
    /// Adds as a child of the current node (creating a branch if needed).
    /// Returns true if the move was legal.
    pub fn try_play(&mut self, col: u8, row: u8) -> bool {
        let stone = self.engine.current_turn_stone();
        if self.engine.try_play(stone, (col, row)).is_ok() {
            let turn = Turn::play(stone, (col, row));
            let new_id = self.tree.add_child(self.current, turn);
            self.current = Some(new_id);
            self.path = self.tree.path_to(new_id);
            true
        } else {
            false
        }
    }

    /// Pass the current turn.
    /// Returns true on success.
    pub fn pass(&mut self) -> bool {
        let stone = self.engine.current_turn_stone();
        if self.engine.try_pass(stone).is_ok() {
            let turn = Turn::pass(stone);
            let new_id = self.tree.add_child(self.current, turn);
            self.current = Some(new_id);
            self.path = self.tree.path_to(new_id);
            true
        } else {
            false
        }
    }

    /// Undo the current node (remove it if it's a leaf, then move to parent).
    pub fn undo(&mut self) -> bool {
        match self.current {
            Some(id) => {
                let parent = self.tree.node(id).parent;
                if self.tree.remove_leaf(id) {
                    self.current = parent;
                    self.path = match parent {
                        Some(pid) => self.tree.path_to(pid),
                        None => Vec::new(),
                    };
                    self.rebuild();
                    true
                } else {
                    // Not a leaf — can't undo
                    false
                }
            }
            None => false,
        }
    }

    // -- Navigation --

    /// Step back one move (move to parent). Returns false if already at start.
    pub fn back(&mut self) -> bool {
        match self.current {
            Some(id) => {
                self.current = self.tree.node(id).parent;
                self.rebuild();
                true
            }
            None => false,
        }
    }

    /// Step forward one move, following the remembered path when possible.
    /// Falls back to children[0] if the path doesn't apply.
    pub fn forward(&mut self) -> bool {
        let children = self.tree.children_of(self.current);
        if children.is_empty() {
            return false;
        }
        let depth = self.view_index();
        let next = if depth < self.path.len() && children.contains(&self.path[depth]) {
            self.path[depth]
        } else {
            self.path.truncate(depth);
            self.path.push(children[0]);
            children[0]
        };
        self.current = Some(next);
        self.rebuild();
        true
    }

    /// Jump to the start (empty board).
    pub fn to_start(&mut self) {
        self.current = None;
        self.rebuild();
    }

    /// Jump to the latest move, following the remembered path.
    pub fn to_latest(&mut self) {
        self.current = self.leaf_from_current();
        if let Some(id) = self.current {
            self.path = self.tree.path_to(id);
        }
        self.rebuild();
    }

    /// Jump to a specific node, remembering the path.
    pub fn navigate_to(&mut self, node_id: NodeId) {
        if node_id < self.tree.len() {
            self.current = Some(node_id);
            self.path = self.tree.path_to(node_id);
            self.rebuild();
        }
    }

    /// Replace the full move history with a flat list.
    /// Builds a fresh linear GameTree and sets current to latest.
    pub fn replace_moves(&mut self, moves: Vec<Turn>) {
        self.tree = GameTree::from_moves(&moves);
        self.path = Self::main_line_path(&self.tree);
        self.current = self.path.last().copied();
        self.rebuild();
    }

    /// Wholesale replace the tree (e.g. from localStorage restore).
    pub fn replace_tree(&mut self, tree: GameTree) {
        self.tree = tree;
        self.path = Self::main_line_path(&self.tree);
        self.current = self.path.last().copied();
        self.rebuild();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Stone;

    #[test]
    fn new_replay_is_at_start_and_latest() {
        let r = Replay::new(9, 9);
        assert!(r.is_at_start());
        assert!(r.is_at_latest());
        assert_eq!(r.total_moves(), 0);
        assert_eq!(r.view_index(), 0);
        assert!(r.last_move().is_none());
    }

    #[test]
    fn play_advances_view() {
        let mut r = Replay::new(9, 9);
        assert!(r.try_play(0, 0));
        assert_eq!(r.total_moves(), 1);
        assert_eq!(r.view_index(), 1);
        assert!(r.is_at_latest());
        assert!(!r.is_at_start());
    }

    #[test]
    fn back_and_forward() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);

        assert!(r.back());
        assert_eq!(r.view_index(), 1);
        assert!(!r.is_at_latest());

        assert!(r.forward());
        assert_eq!(r.view_index(), 2);
        assert!(r.is_at_latest());
    }

    #[test]
    fn back_at_start_returns_false() {
        let mut r = Replay::new(9, 9);
        assert!(!r.back());
    }

    #[test]
    fn forward_at_latest_returns_false() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        assert!(!r.forward());
    }

    #[test]
    fn to_start_and_to_latest() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);

        r.to_start();
        assert!(r.is_at_start());
        assert_eq!(r.view_index(), 0);

        r.to_latest();
        assert!(r.is_at_latest());
        assert_eq!(r.view_index(), 2);
    }

    #[test]
    fn play_creates_branch_instead_of_truncating() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0); // Black at (0,0)
        r.try_play(1, 0); // White at (1,0)
        r.back(); // Back to move 1 (Black at (0,0))

        // Play a different move — creates a branch
        assert!(r.try_play(2, 0)); // White at (2,0) — variation
        assert_eq!(r.view_index(), 2);
        assert!(r.is_at_latest());

        // The tree should have 3 nodes total
        assert_eq!(r.tree().len(), 3);
        // Root's first child has 2 children (the two White variations)
        let root_child = r.tree().root_children()[0];
        assert_eq!(r.tree().children_of(Some(root_child)).len(), 2);
    }

    #[test]
    fn undo_removes_last_move() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);
        assert!(r.undo());
        assert_eq!(r.view_index(), 1);
        assert!(r.is_at_latest());
    }

    #[test]
    fn undo_empty_returns_false() {
        let mut r = Replay::new(9, 9);
        assert!(!r.undo());
    }

    #[test]
    fn undo_non_leaf_returns_false() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);
        r.back();
        // current is at (0,0) which has a child — can't undo
        assert!(!r.undo());
    }

    #[test]
    fn replace_moves_clamps_view() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);
        r.try_play(2, 0);
        assert_eq!(r.view_index(), 3);

        // Replace with fewer moves — sets current to leaf
        let moves = vec![Turn::play(Stone::Black, (0, 0))];
        r.replace_moves(moves);
        assert_eq!(r.total_moves(), 1);
        assert_eq!(r.view_index(), 1);
    }

    #[test]
    fn last_play_pos() {
        let mut r = Replay::new(9, 9);
        assert!(r.last_play_pos().is_none());

        r.try_play(3, 4);
        assert_eq!(r.last_play_pos(), Some((3, 4)));

        r.pass();
        assert!(r.last_play_pos().is_none());
    }

    #[test]
    fn with_moves_constructor() {
        let moves = vec![
            Turn::play(Stone::Black, (0, 0)),
            Turn::play(Stone::White, (1, 0)),
        ];
        let r = Replay::with_moves(9, 9, moves);
        assert_eq!(r.total_moves(), 2);
        assert!(r.is_at_latest());
        assert_eq!(r.engine().current_turn_stone(), Stone::Black);
    }

    #[test]
    fn engine_reflects_view_position() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0); // Black
        r.try_play(1, 0); // White

        r.back();
        // Engine should be at move 1 — white's turn
        assert_eq!(r.engine().current_turn_stone(), Stone::White);
        assert!(r.engine().stone_at((0, 0)).is_some());
        assert!(r.engine().stone_at((1, 0)).is_none());
    }

    #[test]
    fn navigate_to_specific_node() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0); // node 0
        r.try_play(1, 0); // node 1
        r.back();
        r.try_play(2, 0); // node 2 — variation

        // Navigate to node 1 (first variation)
        r.navigate_to(1);
        assert_eq!(r.view_index(), 2);
        assert_eq!(r.last_play_pos(), Some((1, 0)));

        // Navigate to node 2 (second variation)
        r.navigate_to(2);
        assert_eq!(r.view_index(), 2);
        assert_eq!(r.last_play_pos(), Some((2, 0)));
    }

    #[test]
    fn total_moves_follows_main_line() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0); // Black
        r.try_play(1, 0); // White
        r.try_play(2, 0); // Black

        r.to_start();
        // total_moves should follow first children to the leaf
        assert_eq!(r.total_moves(), 3);
        assert_eq!(r.view_index(), 0);
    }

    #[test]
    fn replace_tree_restores_state() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);
        r.back();
        r.try_play(2, 0);

        let tree = r.tree().clone();

        // Start fresh and restore
        let mut r2 = Replay::new(9, 9);
        r2.replace_tree(tree);
        assert_eq!(r2.tree().len(), 3);
        // Should be at the main-line leaf
        assert!(r2.is_at_latest());
    }

    #[test]
    fn replay_same_move_returns_existing_node() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0);
        r.try_play(1, 0);
        r.back();
        // Replay the same move
        r.try_play(1, 0);
        // Should reuse existing node, not create a new one
        assert_eq!(r.tree().len(), 2);
    }

    #[test]
    fn forward_remembers_visited_branch() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0); // node 0: Black (0,0)
        r.try_play(1, 0); // node 1: White (1,0) — main line
        r.back(); // at node 0
        r.try_play(2, 0); // node 2: White (2,0) — variation

        // We're on the variation. Back up to before the branch.
        r.back(); // at node 0
        // Forward should follow the variation (last visited), not main line
        assert!(r.forward());
        assert_eq!(r.last_play_pos(), Some((2, 0)));

        // Navigate to main line explicitly
        r.navigate_to(1);
        assert_eq!(r.last_play_pos(), Some((1, 0)));
        // Back up and forward should now follow main line
        r.back();
        assert!(r.forward());
        assert_eq!(r.last_play_pos(), Some((1, 0)));
    }

    #[test]
    fn to_latest_follows_remembered_path() {
        let mut r = Replay::new(9, 9);
        r.try_play(0, 0); // node 0
        r.try_play(1, 0); // node 1 — main line continues
        r.try_play(2, 0); // node 2
        r.to_start();
        r.forward(); // at node 0
        r.back(); // at root
        r.try_play(3, 3); // node 3 — new root variation
        r.try_play(4, 4); // node 4

        // We're at the end of the new variation. Go to start.
        r.to_start();
        // to_latest should follow the remembered path (the variation)
        r.to_latest();
        assert_eq!(r.last_play_pos(), Some((4, 4)));
    }
}
