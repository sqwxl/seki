use std::collections::HashSet;

use serde::Serialize;

use crate::goban::Goban;
use crate::stone::Stone;
use crate::{GameState, Point};

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

/// Find all unconditionally alive stones of `stone` color using Benson's algorithm.
///
/// A chain is unconditionally alive if it has at least two "vital" enclosed regions
/// (empty regions bordered entirely by friendly chains, where every empty point is
/// a liberty of the chain).
pub fn find_unconditionally_alive(goban: &Goban, stone: Stone) -> HashSet<Point> {
    let cols = goban.cols();
    let rows = goban.rows();

    // Step 1: Find all chains of the given color
    let mut chain_visited = vec![false; cols as usize * rows as usize];
    let mut chains: Vec<Vec<Point>> = Vec::new();

    for y in 0..rows {
        for x in 0..cols {
            let idx = y as usize * cols as usize + x as usize;
            if chain_visited[idx] || goban.stone_at((x, y)) != Some(stone) {
                continue;
            }
            let chain = goban.chain_from((x, y), &mut chain_visited);
            chains.push(chain);
        }
    }

    if chains.is_empty() {
        return HashSet::new();
    }

    // Map each point to its chain index (for stones of our color)
    let size = cols as usize * rows as usize;
    let mut point_to_chain = vec![usize::MAX; size];
    for (ci, chain) in chains.iter().enumerate() {
        for &(cx, cy) in chain {
            point_to_chain[cy as usize * cols as usize + cx as usize] = ci;
        }
    }

    // Track which chains are still in the candidate set
    let mut chain_alive = vec![true; chains.len()];

    // Step 2: Find enclosed regions and iterate until stable
    loop {
        // Find all enclosed regions of the currently-alive chains
        let regions = find_enclosed_regions(goban, stone, &chains, &chain_alive, &point_to_chain);

        // For each alive chain, count its vital regions
        let chain_sets: Vec<HashSet<Point>> = chains
            .iter()
            .map(|chain| chain.iter().copied().collect())
            .collect();
        let mut vital_counts = vec![0usize; chains.len()];
        for region in &regions {
            for &ci in &region.bordering_chains {
                if is_vital_for(goban, region, &chain_sets[ci]) {
                    vital_counts[ci] += 1;
                }
            }
        }

        // Remove chains with fewer than 2 vital regions
        let mut changed = false;
        for ci in 0..chains.len() {
            if chain_alive[ci] && vital_counts[ci] < 2 {
                chain_alive[ci] = false;
                changed = true;
            }
        }

        if !changed {
            break;
        }
    }

    // Collect all points from alive chains
    let mut alive_points = HashSet::new();
    for (ci, chain) in chains.iter().enumerate() {
        if chain_alive[ci] {
            for &pt in chain {
                alive_points.insert(pt);
            }
        }
    }

    alive_points
}

/// An enclosed empty region and the chain indices that border it.
struct EnclosedRegion {
    points: Vec<Point>,
    bordering_chains: Vec<usize>,
}

/// Find all empty regions that are enclosed by the currently-alive chains of `stone` color.
/// A region is enclosed if every bordering stone belongs to an alive chain in the set.
fn find_enclosed_regions(
    goban: &Goban,
    stone: Stone,
    chains: &[Vec<Point>],
    chain_alive: &[bool],
    point_to_chain: &[usize],
) -> Vec<EnclosedRegion> {
    let cols = goban.cols();
    let rows = goban.rows();
    let size = cols as usize * rows as usize;
    let mut visited = vec![false; size];
    let mut regions = Vec::new();

    for y in 0..rows {
        for x in 0..cols {
            let idx = y as usize * cols as usize + x as usize;
            if visited[idx] || goban.stone_at((x, y)).is_some() {
                continue;
            }

            // Flood-fill this empty region
            let mut region_points = Vec::new();
            let mut bordering_chain_set = HashSet::new();
            let mut is_enclosed = true;
            let mut stack = vec![(x, y)];

            while let Some(p) = stack.pop() {
                let pi = p.1 as usize * cols as usize + p.0 as usize;
                if visited[pi] {
                    continue;
                }
                visited[pi] = true;
                region_points.push(p);

                for n in goban.neighbors(p) {
                    let ni = n.1 as usize * cols as usize + n.0 as usize;
                    if visited[ni] {
                        continue;
                    }
                    if let Some(s) = goban.stone_at(n) {
                        // Stone neighbor — check if it belongs to an alive chain
                        if s == stone {
                            let ci = point_to_chain[ni];
                            if ci < chains.len() && chain_alive[ci] {
                                bordering_chain_set.insert(ci);
                            } else {
                                is_enclosed = false;
                            }
                        } else {
                            is_enclosed = false;
                        }
                    } else {
                        stack.push(n);
                    }
                }
            }

            if is_enclosed && !region_points.is_empty() {
                regions.push(EnclosedRegion {
                    points: region_points,
                    bordering_chains: bordering_chain_set.into_iter().collect(),
                });
            }
        }
    }

    regions
}

/// Check if a region is vital for a given chain.
/// A region is vital for chain C if every empty point in the region is also a liberty of C.
fn is_vital_for(goban: &Goban, region: &EnclosedRegion, chain_set: &HashSet<Point>) -> bool {
    region.points.iter().all(|&rp| {
        // rp is an empty point in the region — check if it's adjacent to the chain
        goban.neighbors(rp).iter().any(|n| chain_set.contains(n))
    })
}

/// Detect dead stones using Benson's algorithm + simplified-board heuristic.
///
/// 1. Find unconditionally alive groups for both colors
/// 2. Build a simplified board with only Benson-alive stones
/// 3. Estimate territory on the simplified board
/// 4. Any non-alive stone sitting in opponent territory on the simplified board → dead
///
/// This is conservative: only marks stones that are clearly enclosed by unconditionally
/// alive opponent groups. Ambiguous groups are left alive for players to toggle.
pub fn detect_dead_stones(goban: &Goban) -> HashSet<Point> {
    let mut alive = find_unconditionally_alive(goban, Stone::Black);
    let alive_white = find_unconditionally_alive(goban, Stone::White);
    alive.extend(&alive_white);

    // Build a simplified goban with only Benson-alive stones
    let cols = goban.cols();
    let rows = goban.rows();
    let size = cols as usize * rows as usize;

    let mut simplified_board = vec![0i8; size];
    for &(x, y) in &alive {
        let idx = y as usize * cols as usize + x as usize;
        if let Some(s) = goban.stone_at((x, y)) {
            simplified_board[idx] = s.to_int();
        }
    }

    let simplified_goban = Goban::from_state(GameState {
        board: simplified_board,
        cols,
        rows,
        captures: Default::default(),
        ko: None,
    });

    // Estimate territory on the simplified board (no dead stones to remove)
    let ownership = estimate_territory(&simplified_goban, &HashSet::new());

    // Mark non-alive stones in opponent territory as dead
    let mut dead = HashSet::new();
    for y in 0..rows {
        for x in 0..cols {
            if alive.contains(&(x, y)) {
                continue;
            }
            if let Some(stone) = goban.stone_at((x, y)) {
                let idx = y as usize * cols as usize + x as usize;
                let opponent_val = stone.opp().to_int();
                if ownership[idx] == opponent_val {
                    dead.insert((x, y));
                }
            }
        }
    }

    dead
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

#[cfg(test)]
#[allow(clippy::erasing_op, clippy::identity_op)]
mod tests {
    use super::*;

    /// Build a goban from an ASCII layout. 'B' = Black, 'W' = White, '+' = Empty.
    fn goban_from_layout(layout: &[&str]) -> Goban {
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

    // -- Territory estimation --

    #[test]
    fn empty_board_all_neutral() {
        let goban = Goban::with_dimensions(4, 4);
        let ownership = estimate_territory(&goban, &HashSet::new());
        assert!(ownership.iter().all(|&o| o == 0));
    }

    #[test]
    fn corner_territory_black() {
        // Black controls top-left corner
        let goban = goban_from_layout(&["++B+", "++B+", "BBB+", "++++"]);
        let ownership = estimate_territory(&goban, &HashSet::new());
        // (0,0), (1,0), (0,1), (1,1) should be Black territory
        assert_eq!(ownership[0], 1); // (0,0)
        assert_eq!(ownership[1], 1); // (1,0)
        assert_eq!(ownership[4], 1); // (0,1)
        assert_eq!(ownership[5], 1); // (1,1)
        // The rest of the empty points touch no walls on one side, but
        // the bottom row and right column are open so they're neutral
    }

    #[test]
    fn split_board_both_territories() {
        // Black owns left, White owns right
        // Board: 5 cols x 3 rows
        let goban = goban_from_layout(&["+B+W+", "+B+W+", "+B+W+"]);
        let ownership = estimate_territory(&goban, &HashSet::new());
        let cols = 5;
        // (0,0) is left of Black wall → Black territory
        assert_eq!(ownership[0 * cols + 0], 1);
        assert_eq!(ownership[1 * cols + 0], 1);
        assert_eq!(ownership[2 * cols + 0], 1);
        // (2,0) is between walls → neutral (borders both)
        assert_eq!(ownership[0 * cols + 2], 0);
        // (4,0) is right of White wall → White territory
        assert_eq!(ownership[0 * cols + 4], -1);
        assert_eq!(ownership[1 * cols + 4], -1);
        assert_eq!(ownership[2 * cols + 4], -1);
    }

    #[test]
    fn dame_between_territories() {
        // Middle column touches both colors → neutral
        let goban = goban_from_layout(&["B+W", "B+W", "B+W"]);
        let ownership = estimate_territory(&goban, &HashSet::new());
        let cols = 3;
        // Middle column is dame
        assert_eq!(ownership[0 * cols + 1], 0);
        assert_eq!(ownership[1 * cols + 1], 0);
        assert_eq!(ownership[2 * cols + 1], 0);
    }

    #[test]
    fn dead_stone_positions_get_opponent_ownership() {
        // White stone inside Black territory, marked as dead
        let goban = goban_from_layout(&["BBB", "BWB", "BBB"]);
        let mut dead = HashSet::new();
        dead.insert((1u8, 1u8));

        let ownership = estimate_territory(&goban, &dead);
        // The dead white stone at (1,1) should be Black territory
        assert_eq!(ownership[1 * 3 + 1], 1);
    }

    #[test]
    fn live_stone_has_no_territory_ownership() {
        // A live White stone at (1,1) is not empty on the virtual board,
        // so it has no territory ownership (stays 0).
        let goban = goban_from_layout(&["BBB", "BWB", "BBB"]);
        let ownership = estimate_territory(&goban, &HashSet::new());
        assert_eq!(ownership[1 * 3 + 1], 0);
    }

    // -- Benson's algorithm --

    #[test]
    fn two_eyed_group_is_alive() {
        // Black has two separate internal eyes → unconditionally alive
        let goban = goban_from_layout(&["BBBBB", "B+B+B", "BBBBB"]);
        let alive = find_unconditionally_alive(&goban, Stone::Black);
        // All Black stones should be alive
        for y in 0..3u8 {
            for x in 0..5u8 {
                if goban.stone_at((x, y)) == Some(Stone::Black) {
                    assert!(alive.contains(&(x, y)), "({x},{y}) should be alive");
                }
            }
        }
    }

    #[test]
    fn one_eyed_group_not_alive() {
        // Black has only one eye → NOT unconditionally alive
        let goban = goban_from_layout(&["BBB", "B+B", "BBB"]);
        let alive = find_unconditionally_alive(&goban, Stone::Black);
        assert!(
            alive.is_empty(),
            "one-eyed group should not be unconditionally alive"
        );
    }

    #[test]
    fn no_alive_groups_on_empty_board() {
        let goban = Goban::with_dimensions(4, 4);
        let alive = find_unconditionally_alive(&goban, Stone::Black);
        assert!(alive.is_empty());
    }

    #[test]
    fn corner_two_eyed_group_alive() {
        // Black has two eyes in the corner
        let goban = goban_from_layout(&["+B+B", "BBBB", "++++", "++++"]);
        let alive = find_unconditionally_alive(&goban, Stone::Black);
        // All Black stones in the top two rows should be alive
        assert!(alive.contains(&(1, 0)));
        assert!(alive.contains(&(3, 0)));
        assert!(alive.contains(&(0, 1)));
        assert!(alive.contains(&(1, 1)));
        assert!(alive.contains(&(2, 1)));
        assert!(alive.contains(&(3, 1)));
    }

    #[test]
    fn white_alive_group() {
        // Same test but for White
        let goban = goban_from_layout(&["WWWWW", "W+W+W", "WWWWW"]);
        let alive = find_unconditionally_alive(&goban, Stone::White);
        for y in 0..3u8 {
            for x in 0..5u8 {
                if goban.stone_at((x, y)) == Some(Stone::White) {
                    assert!(alive.contains(&(x, y)), "({x},{y}) should be alive");
                }
            }
        }
    }

    // -- Dead stone detection --

    #[test]
    fn stone_inside_benson_alive_group_is_dead() {
        // Black has two eyes enclosing a White stone
        // White stone at (3,1) has a liberty at (2,2), but Black is Benson-alive
        let goban = goban_from_layout(&["BBBBB", "B+BWB", "BB+BB", "B+BBB", "BBBBB"]);
        let dead = detect_dead_stones(&goban);
        assert!(
            dead.contains(&(3u8, 1u8)),
            "enclosed white stone should be dead"
        );
        // Black stones should NOT be dead
        for y in 0..5u8 {
            for x in 0..5u8 {
                if goban.stone_at((x, y)) == Some(Stone::Black) {
                    assert!(
                        !dead.contains(&(x, y)),
                        "black at ({x},{y}) should not be dead"
                    );
                }
            }
        }
    }

    #[test]
    fn chain_inside_benson_alive_group_is_dead() {
        // Black has two eyes enclosing a White chain
        let goban = goban_from_layout(&["BBBBBB", "B+BWWB", "BBBWWB", "B+BBBB", "BBBBBB"]);
        let dead = detect_dead_stones(&goban);
        assert!(
            dead.contains(&(3u8, 1u8)),
            "enclosed white at (3,1) should be dead"
        );
        assert!(
            dead.contains(&(4u8, 1u8)),
            "enclosed white at (4,1) should be dead"
        );
        assert!(
            dead.contains(&(3u8, 2u8)),
            "enclosed white at (3,2) should be dead"
        );
        assert!(
            dead.contains(&(4u8, 2u8)),
            "enclosed white at (4,2) should be dead"
        );
    }

    #[test]
    fn two_eyed_group_not_detected_as_dead() {
        // Black group with two eyes — Benson-alive, never detected as dead
        let goban = goban_from_layout(&["WBBBW", "WB+BW", "WBBBW", "WB+BW", "WBBBW"]);
        let dead = detect_dead_stones(&goban);
        for y in 0..5u8 {
            for x in 0..5u8 {
                if goban.stone_at((x, y)) == Some(Stone::Black) {
                    assert!(!dead.contains(&(x, y)), "({x},{y}) should not be dead");
                }
            }
        }
    }

    #[test]
    fn non_alive_group_in_neutral_area_not_dead() {
        // Neither side has Benson-alive groups → no dead stones detected
        let goban = goban_from_layout(&["BBB++", "B+B++", "BBB++", "++WWW", "++W+W"]);
        let dead = detect_dead_stones(&goban);
        assert!(
            dead.is_empty(),
            "no dead stones when no group is Benson-alive"
        );
    }

    // -- Toggle dead chain --

    #[test]
    fn toggle_marks_chain_dead() {
        let goban = goban_from_layout(&["BBB", "BWB", "BBB"]);
        let mut dead = HashSet::new();
        toggle_dead_chain(&goban, &mut dead, (1, 1));
        assert!(dead.contains(&(1u8, 1u8)));
    }

    #[test]
    fn toggle_marks_chain_alive_again() {
        let goban = goban_from_layout(&["BBB", "BWB", "BBB"]);
        let mut dead = HashSet::new();
        toggle_dead_chain(&goban, &mut dead, (1, 1));
        assert!(dead.contains(&(1u8, 1u8)));
        toggle_dead_chain(&goban, &mut dead, (1, 1));
        assert!(!dead.contains(&(1u8, 1u8)));
    }

    #[test]
    fn toggle_on_empty_is_noop() {
        let goban = Goban::with_dimensions(4, 4);
        let mut dead = HashSet::new();
        toggle_dead_chain(&goban, &mut dead, (0, 0));
        assert!(dead.is_empty());
    }

    #[test]
    fn toggle_toggles_entire_chain() {
        let goban = goban_from_layout(&["+++++", "+BWW+", "+BWW+", "+++++", "+++++"]);
        let mut dead = HashSet::new();
        // Click on one white stone in a 2x2 chain
        toggle_dead_chain(&goban, &mut dead, (2, 1));
        assert!(dead.contains(&(2u8, 1u8)));
        assert!(dead.contains(&(3u8, 1u8)));
        assert!(dead.contains(&(2u8, 2u8)));
        assert!(dead.contains(&(3u8, 2u8)));
    }

    // -- Scoring --

    #[test]
    fn scoring_simple() {
        // 3x3 board: Black owns all territory, White has a dead stone
        let goban = goban_from_layout(&["BBB", "BWB", "BBB"]);
        let mut dead = HashSet::new();
        dead.insert((1u8, 1u8));
        let ownership = estimate_territory(&goban, &dead);
        let gs = score(&goban, &ownership, &dead, 0.0);

        // Black territory = 1 (center), captures = 0, dead white = 1
        assert_eq!(gs.black.territory, 1);
        assert_eq!(gs.black.captures, 1);
        assert_eq!(gs.black_total(), 2.0);
        assert_eq!(gs.white_total(), 0.0);
    }

    #[test]
    fn scoring_with_komi() {
        let goban = goban_from_layout(&["BBB", "BWB", "BBB"]);
        let mut dead = HashSet::new();
        dead.insert((1u8, 1u8));
        let ownership = estimate_territory(&goban, &dead);
        let gs = score(&goban, &ownership, &dead, 6.5);

        assert_eq!(gs.black_total(), 2.0);
        assert_eq!(gs.white_total(), 6.5);
    }

    #[test]
    fn scoring_with_captures() {
        // Simulate a board where Black has captured 3 stones
        let goban = Goban::from_state(GameState {
            board: vec![
                1, 1, 1, 0, -1, 1, 0, 1, 0, -1, 1, 1, 1, 0, -1, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1,
            ],
            cols: 5,
            rows: 5,
            captures: crate::goban::Captures { black: 3, white: 0 },
            ko: None,
        });
        let dead = HashSet::new();
        let ownership = estimate_territory(&goban, &dead);
        let gs = score(&goban, &ownership, &dead, 6.5);

        // Black territory: (1,1) = 1 point
        // Black captures: 3
        // The middle column (col 3) borders both → neutral
        assert_eq!(ownership[1 * 5 + 1], 1); // (1,1) Black territory
        assert_eq!(gs.black.territory, 1);
        assert_eq!(gs.black.captures, 3);
        assert_eq!(gs.black_total(), 4.0); // 1 territory + 3 captures
        assert_eq!(gs.white_total(), 6.5); // 0 territory + 0 captures + 6.5 komi
    }

    // -- Result formatting --

    #[test]
    fn format_result_black_wins() {
        assert_eq!(format_result(10.0, 5.5), "B+4.5");
    }

    #[test]
    fn format_result_white_wins() {
        assert_eq!(format_result(5.0, 11.5), "W+6.5");
    }

    #[test]
    fn format_result_draw() {
        assert_eq!(format_result(5.0, 5.0), "Draw");
    }

    // -- Reference positions (adapted from goscorer by lightvector) --

    #[test]
    fn goscorer_basic_territory() {
        // goscorer test_basic: 9x9 with Black wall on col 6, White boundary at bottom-left.
        // Black territory: 10 pts (right of wall), White territory: 19 pts (bottom-left),
        // top-left and bottom-right regions are neutral (border both colors).
        let goban = goban_from_layout(&[
            "++++++B++",
            "+BB+B+B++",
            "++++++B++",
            "++++++B++",
            "WWWWWWB++",
            "+++++WBBB",
            "+++++W+W+",
            "+++W+W++W",
            "+++++W+++",
        ]);
        let ownership = estimate_territory(&goban, &HashSet::new());
        let cols = 9;

        // Black territory: cols 7-8, rows 0-4
        for row in 0..5u8 {
            for col in 7..9u8 {
                assert_eq!(
                    ownership[row as usize * cols + col as usize],
                    1,
                    "({col},{row}) should be Black territory"
                );
            }
        }

        // White territory: bottom-left enclosed region (19 points)
        let white_points: Vec<(usize, usize)> = vec![
            // row 5: cols 0-4
            (0, 5),
            (1, 5),
            (2, 5),
            (3, 5),
            (4, 5),
            // row 6: cols 0-4
            (0, 6),
            (1, 6),
            (2, 6),
            (3, 6),
            (4, 6),
            // row 7: cols 0-2 and col 4
            (0, 7),
            (1, 7),
            (2, 7),
            (4, 7),
            // row 8: cols 0-4
            (0, 8),
            (1, 8),
            (2, 8),
            (3, 8),
            (4, 8),
        ];
        for (col, row) in &white_points {
            assert_eq!(
                ownership[row * cols + col],
                -1,
                "({col},{row}) should be White territory"
            );
        }

        // Top-left region is neutral (borders both B and W)
        assert_eq!(ownership[0], 0, "(0,0) neutral");
        assert_eq!(ownership[5], 0, "(5,0) neutral");

        // Bottom-right dots are neutral (border both B and W via (6,5)=B and surrounding W)
        assert_eq!(ownership[6 * cols + 6], 0, "(6,6) neutral");
        assert_eq!(ownership[8 * cols + 8], 0, "(8,8) neutral");
    }

    #[test]
    fn goscorer_dead_stone_marking_territory() {
        // Adapted from goscorer test_dead_stone_marking: 9x9 with dead stones of both colors.
        // Dead W at (2,0), (7,0), (8,1); dead B at (1,6), (1,7), (7,8).
        let goban = goban_from_layout(&[
            "++W+++BW+",
            "+BB+B+B+W",
            "++++++BBB",
            "++++++B+W",
            "WWWWWWB++",
            "W+W+BWBBB",
            "WBWBBW+W+",
            "WB+W+W++W",
            "+WWWWW+B+",
        ]);
        let mut dead = HashSet::new();
        dead.insert((2u8, 0u8));
        dead.insert((7u8, 0u8));
        dead.insert((8u8, 1u8));
        dead.insert((1u8, 6u8));
        dead.insert((1u8, 7u8));
        dead.insert((7u8, 8u8));

        let ownership = estimate_territory(&goban, &dead);
        let cols = 9;

        // Black territory: right side empty points after removing dead W at (7,0) and (8,1).
        // Region {(7,0), (8,0), (7,1), (8,1)} bordered only by Black → 4 pts Black territory.
        assert_eq!(ownership[0 * cols + 7], 1, "(7,0) Black territory");
        assert_eq!(ownership[0 * cols + 8], 1, "(8,0) Black territory");
        assert_eq!(ownership[1 * cols + 7], 1, "(7,1) Black territory");
        assert_eq!(ownership[1 * cols + 8], 1, "(8,1) Black territory");

        // Dead W at (2,0) is in the top-left region which borders both colors → neutral.
        assert_eq!(
            ownership[0 * cols + 2],
            0,
            "dead W at (2,0) in neutral region"
        );

        // (7,3) borders B(6,3) and W(8,3) → neutral
        assert_eq!(ownership[3 * cols + 7], 0, "(7,3) neutral");

        // White territory: bottom-left enclosed region
        assert_eq!(ownership[8 * cols + 0], -1, "(0,8) White territory");
        // Dead B at (1,6) and (1,7): their positions are surrounded by White → White territory
        assert_eq!(
            ownership[6 * cols + 1],
            -1,
            "dead B at (1,6) → White territory"
        );
        assert_eq!(
            ownership[7 * cols + 1],
            -1,
            "dead B at (1,7) → White territory"
        );
    }

    // -- Seki / conservative detection --

    #[test]
    fn seki_conservative_no_dead_detected() {
        // Mutual-life position: Black frame encloses White group, but Black's
        // internal empty points border White stones, so Black is NOT Benson-alive.
        // White similarly has no two eyes. Neither group is alive.
        // Conservative algorithm should detect NO dead stones.
        let goban = goban_from_layout(&["BBBBB", "B+BWB", "BWWWB", "BWB+B", "BBBBB"]);
        let dead = detect_dead_stones(&goban);
        assert!(
            dead.is_empty(),
            "seki-like position: no dead stones detected"
        );
    }

    #[test]
    fn one_eyed_groups_not_dead_without_benson_alive_opponent() {
        // Both sides have one-eyed groups. Neither is Benson-alive.
        // No dead stones should be detected (conservative approach).
        let goban = goban_from_layout(&["BBB++", "B+B++", "BBB++", "++WWW", "++W+W", "++WWW"]);
        let dead = detect_dead_stones(&goban);
        assert!(
            dead.is_empty(),
            "one-eyed groups without Benson-alive opponent: no dead stones"
        );
    }

    // -- Dead stones of both colors --

    #[test]
    fn dead_stones_both_colors_detected() {
        // Left half: Black Benson-alive with 3 eyes, enclosing dead W at (3,1).
        // Right half: White Benson-alive with 3 eyes, enclosing dead B at (9,1).
        // Middle column (5) is empty separator.
        let goban = goban_from_layout(&[
            "BBBBB+WWWWW",
            "B+BWB+W+WBW",
            "BB+BB+WW+WW",
            "B+BBB+W+WWW",
            "BBBBB+WWWWW",
        ]);
        let dead = detect_dead_stones(&goban);
        assert!(dead.contains(&(3u8, 1u8)), "W at (3,1) should be dead");
        assert!(dead.contains(&(9u8, 1u8)), "B at (9,1) should be dead");
        assert_eq!(dead.len(), 2, "exactly 2 dead stones");
    }

    #[test]
    fn scoring_with_dead_stones_both_colors() {
        // Same position as dead_stones_both_colors_detected, verify full scoring pipeline.
        let goban = goban_from_layout(&[
            "BBBBB+WWWWW",
            "B+BWB+W+WBW",
            "BB+BB+WW+WW",
            "B+BBB+W+WWW",
            "BBBBB+WWWWW",
        ]);
        let dead = detect_dead_stones(&goban);
        let ownership = estimate_territory(&goban, &dead);
        let gs = score(&goban, &ownership, &dead, 6.5);

        // Black territory: 3 internal eyes (1,1), (2,2), (1,3) + dead W pos (3,1) = 4 pts
        // Black prisoners: 1 dead W
        // White territory: 3 internal eyes (7,1), (8,2), (7,3) + dead B pos (9,1) = 4 pts
        // White prisoners: 1 dead B + 6.5 komi
        // Middle column (5) is neutral (borders both)
        assert_eq!(gs.black.territory, 4);
        assert_eq!(gs.black.captures, 1);
        assert_eq!(gs.white.territory, 4);
        assert_eq!(gs.white.captures, 1);
        assert_eq!(gs.result(), "W+6.5");
    }

    // -- Benson's with mixed colors --

    #[test]
    fn benson_alive_with_adjacent_opponent_stones() {
        // Black group with two eyes, White stones on the outside.
        // Black should still be Benson-alive.
        let goban = goban_from_layout(&["WBBBW", "WB+BW", "WBBBW", "WB+BW", "WBBBW"]);
        let alive_b = find_unconditionally_alive(&goban, Stone::Black);
        // All Black stones should be alive (two eyes at (2,1) and (2,3))
        for y in 0..5u8 {
            for x in 0..5u8 {
                if goban.stone_at((x, y)) == Some(Stone::Black) {
                    assert!(alive_b.contains(&(x, y)), "B at ({x},{y}) should be alive");
                }
            }
        }

        // White is NOT Benson-alive (no enclosed regions — all empty regions border B)
        let alive_w = find_unconditionally_alive(&goban, Stone::White);
        assert!(
            alive_w.is_empty(),
            "White has no enclosed regions, not alive"
        );
    }

    // -- Larger board --

    #[test]
    fn solid_eyeshapes_territory() {
        // Adapted from goscorer test_solid_eyeshapes: 32-wide board with only Black stones.
        // All empty regions are enclosed by Black only → all Black territory.
        let goban = goban_from_layout(&[
            "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            "B+BB++BB+BBB++BBBBB++BBBB++BBBBB",
            "BBBBBBBB++BB++BBBBBB++BB++++BBBB",
            "B+++BBBBB+BBBBBBBBBB+BBBBBBBB+++",
            "BBBBB++BBBBB++BBB+BBBB+BBBBBBB++",
            "B++BB+BBBBBB++BB+++BB+++BBBBBBB+",
            "BB+BB+BB+BBB+BBBB+BBB++BBB+++BBB",
            "BBBBBBB+++BBBBBBBBBBBBBBBB+++BBB",
            "B++++BBBBBBBBBBBBBBBBBBBBBBBBBBB",
        ]);
        let ownership = estimate_territory(&goban, &HashSet::new());
        // Every empty point should be Black territory (bordered only by Black)
        let cols = 32;
        for (i, &o) in ownership.iter().enumerate() {
            let x = i % cols;
            let y = i / cols;
            if goban.stone_at((x as u8, y as u8)).is_none() {
                assert_eq!(o, 1, "({x},{y}) should be Black territory");
            }
        }
    }
}
