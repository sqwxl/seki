pub mod engine;
pub mod error;
pub mod game_tree;
pub mod goban;
pub mod handicap;
pub mod ko;
pub mod replay;
pub mod sgf;
pub mod stone;
pub mod territory;
pub mod turn;

pub type Point = (u8, u8);

pub use engine::{Engine, GameState, Stage};
pub use error::GoError;
pub use game_tree::{GameTree, NodeId, TreeNode};
pub use goban::Goban;
pub use ko::Ko;
pub use replay::Replay;
pub use stone::Stone;
pub use turn::{Move, Turn};

#[cfg(test)]
pub(crate) mod test_utils {
    use crate::goban::Goban;
    use crate::stone::Stone;

    /// Build a goban from an ASCII layout. 'B' = Black, 'W' = White, '+' = Empty.
    pub fn goban_from_layout(layout: &[&str]) -> Goban {
        let board: Vec<Vec<i8>> = layout
            .iter()
            .map(|row| {
                row.chars()
                    .map(|c| match c {
                        'B' => Stone::Black.to_int(),
                        'W' => Stone::White.to_int(),
                        _ => 0,
                    })
                    .collect()
            })
            .collect();
        Goban::new(board)
    }
}
