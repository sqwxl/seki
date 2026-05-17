use std::collections::HashSet;

use serde::Serialize;

use crate::Point;
use crate::goban::Goban;
use crate::stone::Stone;

/// Estimate territory ownership for each point on the board.
///
/// Returns a flat array (same layout as `goban.board()`) where:
/// - `1` = Black territory
/// - `-1` = White territory
/// - `0` = neutral / dame
///
/// Points occupied by dead stones get the capturing color's ownership.
pub fn estimate_territory(goban: &Goban, dead_stones: &HashSet<Point>) -> Vec<i8> {
    let cols = goban.cols();
    let rows = goban.rows();
    let size = cols as usize * rows as usize;

    // Build virtual board with dead stones removed
    let mut virtual_board = goban.board().to_vec();
    for &(col, row) in dead_stones {
        let idx = row as usize * cols as usize + col as usize;
        if idx < size {
            virtual_board[idx] = 0;
        }
    }

    let mut ownership = vec![0i8; size];
    let mut visited = vec![false; size];

    for y in 0..rows {
        for x in 0..cols {
            let idx = y as usize * cols as usize + x as usize;
            if visited[idx] || virtual_board[idx] != 0 {
                continue;
            }

            // Flood-fill this empty region
            let mut region = Vec::new();
            let mut border_colors: u8 = 0; // bit 0 = Black seen, bit 1 = White seen
            let mut stack = vec![(x, y)];

            while let Some(p) = stack.pop() {
                let pi = p.1 as usize * cols as usize + p.0 as usize;
                if visited[pi] {
                    continue;
                }
                visited[pi] = true;
                region.push(pi);

                for n in goban.neighbors(p) {
                    let ni = n.1 as usize * cols as usize + n.0 as usize;
                    if visited[ni] {
                        continue;
                    }
                    if virtual_board[ni] != 0 {
                        // Stone neighbor — record border color, don't add to stack
                        match virtual_board[ni].signum() {
                            1 => border_colors |= 1,
                            -1 => border_colors |= 2,
                            _ => {}
                        }
                    } else {
                        stack.push(n);
                    }
                }
            }

            // Assign ownership based on bordering colors
            let owner = match border_colors {
                1 => 1i8,  // only Black borders
                2 => -1i8, // only White borders
                _ => 0i8,  // both, neither, or no borders
            };

            for &pi in &region {
                ownership[pi] = owner;
            }
        }
    }

    ownership
}

/// Toggle all stones in the chain at `point` as dead/alive.
///
/// If any stone in the chain is currently dead, removes all from dead_stones (marks alive).
/// Otherwise, adds all to dead_stones (marks dead).
/// No-op if the point has no stone.
pub fn toggle_dead_chain(goban: &Goban, dead_stones: &mut HashSet<Point>, point: Point) {
    if goban.stone_at(point).is_none() {
        return;
    }

    let chain = goban.chain(point);
    let any_dead = chain.iter().any(|pt| dead_stones.contains(pt));

    if any_dead {
        for &pt in &chain {
            dead_stones.remove(&pt);
        }
    } else {
        for &pt in &chain {
            dead_stones.insert(pt);
        }
    }
}

/// Per-color score breakdown: territory (empty points) and captures (prisoners + dead stones).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PlayerPoints {
    pub territory: u32,
    pub captures: u32,
}

impl PlayerPoints {
    pub fn total(&self) -> u32 {
        self.territory + self.captures
    }
}

/// Full score breakdown for both players.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct GameScore {
    pub black: PlayerPoints,
    pub white: PlayerPoints,
    pub komi: f64,
}

impl GameScore {
    pub fn black_total(&self) -> f64 {
        self.black.total() as f64
    }

    pub fn white_total(&self) -> f64 {
        self.white.total() as f64 + self.komi
    }

    pub fn result(&self) -> String {
        format_result(self.black_total(), self.white_total())
    }
}

/// Calculate final scores with full breakdown.
///
/// Uses Japanese-style scoring:
/// score = territory + captures (including dead opponent stones) + komi (White only)
pub fn score(
    goban: &Goban,
    ownership: &[i8],
    dead_stones: &HashSet<Point>,
    komi: f64,
) -> GameScore {
    let mut black_territory: u32 = 0;
    let mut white_territory: u32 = 0;

    for &o in ownership {
        match o {
            1 => black_territory += 1,
            -1 => white_territory += 1,
            _ => {}
        }
    }

    let mut dead_black: u32 = 0;
    let mut dead_white: u32 = 0;

    for &pt in dead_stones {
        match goban.stone_at(pt) {
            Some(Stone::Black) => dead_black += 1,
            Some(Stone::White) => dead_white += 1,
            None => {}
        }
    }

    GameScore {
        black: PlayerPoints {
            territory: black_territory,
            captures: goban.captures().get(Stone::Black) + dead_white,
        },
        white: PlayerPoints {
            territory: white_territory,
            captures: goban.captures().get(Stone::White) + dead_black,
        },
        komi,
    }
}

/// Format the game result string from final scores.
///
/// Returns "B+{diff}", "W+{diff}", or "Draw".
pub fn format_result(black_score: f64, white_score: f64) -> String {
    let diff = black_score - white_score;
    if diff > 0.0 {
        format!("B+{}", diff)
    } else if diff < 0.0 {
        format!("W+{}", -diff)
    } else {
        "Draw".to_string()
    }
}
