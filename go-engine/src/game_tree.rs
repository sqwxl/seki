use serde::{Deserialize, Serialize};

use crate::turn::Turn;

pub type NodeId = usize;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub turn: Turn,
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    #[serde(default)]
    pub depth: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameTree {
    nodes: Vec<TreeNode>,
    root_children: Vec<NodeId>,
}

impl GameTree {
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            root_children: Vec::new(),
        }
    }

    pub fn from_moves(moves: &[Turn]) -> Self {
        let mut tree = Self::new();
        let mut parent = None;
        for turn in moves {
            parent = Some(tree.add_child(parent, turn.clone()));
        }
        tree
    }

    /// Add a child turn under the given parent (None = root).
    /// If an identical child already exists, returns its id instead of duplicating.
    pub fn add_child(&mut self, parent: Option<NodeId>, turn: Turn) -> NodeId {
        let siblings = match parent {
            Some(pid) => &self.nodes[pid].children,
            None => &self.root_children,
        };

        // Check for existing identical child
        for &child_id in siblings {
            if self.nodes[child_id].turn == turn {
                return child_id;
            }
        }

        let depth = match parent {
            Some(pid) => self.nodes[pid].depth + 1,
            None => 1,
        };

        let id = self.nodes.len();
        self.nodes.push(TreeNode {
            turn,
            parent,
            children: Vec::new(),
            depth,
        });

        match parent {
            Some(pid) => self.nodes[pid].children.push(id),
            None => self.root_children.push(id),
        }

        id
    }

    /// Walk parent links from node to root, return path (root-first order).
    pub fn path_to(&self, node_id: NodeId) -> Vec<NodeId> {
        let mut path = Vec::new();
        let mut current = Some(node_id);
        while let Some(id) = current {
            path.push(id);
            current = self.nodes[id].parent;
        }
        path.reverse();
        path
    }

    /// Return the sequence of turns from root to the given node.
    pub fn moves_to(&self, node_id: NodeId) -> Vec<Turn> {
        self.path_to(node_id)
            .iter()
            .map(|&id| self.nodes[id].turn.clone())
            .collect()
    }

    pub fn children_of(&self, parent: Option<NodeId>) -> &[NodeId] {
        match parent {
            Some(pid) => &self.nodes[pid].children,
            None => &self.root_children,
        }
    }

    pub fn node(&self, id: NodeId) -> &TreeNode {
        &self.nodes[id]
    }

    pub fn depth(&self, id: NodeId) -> usize {
        self.nodes[id].depth
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    pub fn root_children(&self) -> &[NodeId] {
        &self.root_children
    }

    pub fn nodes(&self) -> &[TreeNode] {
        &self.nodes
    }

    /// Remove a leaf node (one with no children). Returns true if removed.
    pub fn remove_leaf(&mut self, node_id: NodeId) -> bool {
        if node_id >= self.nodes.len() || !self.nodes[node_id].children.is_empty() {
            return false;
        }

        // Remove from parent's children list
        match self.nodes[node_id].parent {
            Some(pid) => self.nodes[pid].children.retain(|&id| id != node_id),
            None => self.root_children.retain(|&id| id != node_id),
        }

        // We don't compact the arena — the slot becomes orphaned but that's fine
        // for the typical usage pattern (small trees in analysis mode).
        true
    }
}

impl Default for GameTree {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Stone;

    #[test]
    fn empty_tree() {
        let tree = GameTree::new();
        assert_eq!(tree.len(), 0);
        assert!(tree.is_empty());
        assert!(tree.children_of(None).is_empty());
    }

    #[test]
    fn linear_from_moves() {
        let moves = vec![
            Turn::play(Stone::Black, (0, 0)),
            Turn::play(Stone::White, (1, 0)),
            Turn::play(Stone::Black, (2, 0)),
        ];
        let tree = GameTree::from_moves(&moves);
        assert_eq!(tree.len(), 3);
        assert_eq!(tree.root_children().len(), 1);

        // Follow the linear chain
        let root_child = tree.root_children()[0];
        assert_eq!(tree.node(root_child).turn, moves[0]);
        assert_eq!(tree.node(root_child).children.len(), 1);

        let second = tree.node(root_child).children[0];
        assert_eq!(tree.node(second).turn, moves[1]);

        let third = tree.node(second).children[0];
        assert_eq!(tree.node(third).turn, moves[2]);
        assert!(tree.node(third).children.is_empty());
    }

    #[test]
    fn path_to_and_moves_to() {
        let moves = vec![
            Turn::play(Stone::Black, (0, 0)),
            Turn::play(Stone::White, (1, 0)),
        ];
        let tree = GameTree::from_moves(&moves);

        let leaf = tree.root_children()[0];
        let leaf = tree.node(leaf).children[0];

        let path = tree.path_to(leaf);
        assert_eq!(path.len(), 2);
        assert_eq!(path[0], 0);
        assert_eq!(path[1], 1);

        let turns = tree.moves_to(leaf);
        assert_eq!(turns, moves);
    }

    #[test]
    fn branching() {
        let mut tree = GameTree::new();
        let a = tree.add_child(None, Turn::play(Stone::Black, (0, 0)));
        let b = tree.add_child(Some(a), Turn::play(Stone::White, (1, 0)));
        let c = tree.add_child(Some(a), Turn::play(Stone::White, (2, 0)));

        assert_eq!(tree.children_of(Some(a)).len(), 2);
        assert_eq!(tree.children_of(Some(a))[0], b);
        assert_eq!(tree.children_of(Some(a))[1], c);

        // Paths diverge
        let path_b = tree.moves_to(b);
        assert_eq!(path_b[1], Turn::play(Stone::White, (1, 0)));

        let path_c = tree.moves_to(c);
        assert_eq!(path_c[1], Turn::play(Stone::White, (2, 0)));
    }

    #[test]
    fn no_duplicate_children() {
        let mut tree = GameTree::new();
        let a = tree.add_child(None, Turn::play(Stone::Black, (0, 0)));
        let b1 = tree.add_child(Some(a), Turn::play(Stone::White, (1, 0)));
        let b2 = tree.add_child(Some(a), Turn::play(Stone::White, (1, 0)));

        assert_eq!(b1, b2);
        assert_eq!(tree.children_of(Some(a)).len(), 1);
        assert_eq!(tree.len(), 2);
    }

    #[test]
    fn remove_leaf() {
        let mut tree = GameTree::new();
        let a = tree.add_child(None, Turn::play(Stone::Black, (0, 0)));
        let b = tree.add_child(Some(a), Turn::play(Stone::White, (1, 0)));

        // Can't remove non-leaf
        assert!(!tree.remove_leaf(a));

        // Can remove leaf
        assert!(tree.remove_leaf(b));
        assert!(tree.children_of(Some(a)).is_empty());
    }

    #[test]
    fn remove_root_leaf() {
        let mut tree = GameTree::new();
        let a = tree.add_child(None, Turn::play(Stone::Black, (0, 0)));

        assert!(tree.remove_leaf(a));
        assert!(tree.root_children().is_empty());
    }

    #[test]
    fn children_of_root() {
        let mut tree = GameTree::new();
        tree.add_child(None, Turn::play(Stone::Black, (0, 0)));
        tree.add_child(None, Turn::play(Stone::Black, (1, 1)));

        assert_eq!(tree.children_of(None).len(), 2);
        assert_eq!(tree.root_children().len(), 2);
    }

    #[test]
    fn from_moves_empty() {
        let tree = GameTree::from_moves(&[]);
        assert!(tree.is_empty());
        assert!(tree.root_children().is_empty());
    }

    #[test]
    fn serialization_roundtrip() {
        let moves = vec![
            Turn::play(Stone::Black, (3, 3)),
            Turn::play(Stone::White, (15, 15)),
        ];
        let mut tree = GameTree::from_moves(&moves);
        // Add a branch
        let root = tree.root_children()[0];
        tree.add_child(Some(root), Turn::play(Stone::White, (16, 3)));

        let json = serde_json::to_string(&tree).unwrap();
        let restored: GameTree = serde_json::from_str(&json).unwrap();

        assert_eq!(restored.len(), tree.len());
        assert_eq!(restored.root_children().len(), 1);
        assert_eq!(restored.children_of(Some(root)).len(), 2);
    }
}
