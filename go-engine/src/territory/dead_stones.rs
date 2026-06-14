use std::collections::HashSet;

use crate::goban::Goban;
use crate::stone::Stone;
use crate::{GameState, Point};

use super::alive::find_unconditionally_alive;
use super::scoring::estimate_territory;

// ---------------------------------------------------------------------------
// Xorshift128 PRNG (deterministic, no external crate)
// ---------------------------------------------------------------------------
struct Rng {
    s: [u32; 4],
}

impl Rng {
    fn new(seed: u64) -> Self {
        // Split seed into four nonzero 32-bit words
        let mut s = [
            (seed & 0xFFFF_FFFF) as u32,
            (seed >> 32) as u32,
            seed.wrapping_mul(6364136223846793005) as u32,
            (seed.wrapping_mul(6364136223846793005) >> 32) as u32,
        ];
        // Ensure no zero state
        for v in &mut s {
            if *v == 0 {
                *v = 0xDEAD_BEEF;
            }
        }
        Self { s }
    }

    fn next(&mut self) -> u32 {
        let t = self.s[3];
        let mut s = self.s[0];
        self.s[3] = self.s[2];
        self.s[2] = self.s[1];
        self.s[1] = s;
        s ^= s << 11;
        s ^= s >> 8;
        self.s[0] = s ^ t ^ (t >> 19);
        self.s[0]
    }

    fn range(&mut self, n: usize) -> usize {
        (self.next() as usize) % n
    }
}

// ---------------------------------------------------------------------------
// PlayoutBoard — lightweight mutable board for fast random playouts
// ---------------------------------------------------------------------------

struct PlayoutBoard {
    data: Vec<i8>,
    cols: usize,
    rows: usize,
}

impl PlayoutBoard {
    fn from_goban(goban: &Goban) -> Self {
        Self {
            data: goban.board().to_vec(),
            cols: goban.cols() as usize,
            rows: goban.rows() as usize,
        }
    }

    #[inline]
    fn size(&self) -> usize {
        self.cols * self.rows
    }

    #[inline]
    fn get(&self, v: usize) -> i8 {
        self.data[v]
    }

    /// 4-connected neighbors as flat indices.
    fn neighbors(&self, v: usize) -> arrayvec::ArrayVec<usize, 4> {
        let mut result = arrayvec::ArrayVec::new();
        let x = v % self.cols;
        let y = v / self.cols;
        if x > 0 {
            result.push(v - 1);
        }
        if x + 1 < self.cols {
            result.push(v + 1);
        }
        if y > 0 {
            result.push(v - self.cols);
        }
        if y + 1 < self.rows {
            result.push(v + self.cols);
        }
        result
    }

    /// Does the chain containing `v` have at least one liberty? Early-exit DFS.
    fn has_liberties(&self, v: usize, visited: &mut [bool]) -> bool {
        let sign = self.data[v];
        let mut stack = vec![v];
        while let Some(u) = stack.pop() {
            if visited[u] {
                continue;
            }
            visited[u] = true;
            for n in self.neighbors(u) {
                if self.data[n] == 0 {
                    return true;
                }
                if self.data[n] == sign && !visited[n] {
                    stack.push(n);
                }
            }
        }
        false
    }

    /// Flood-fill chain from `v`.
    fn get_chain(&self, v: usize) -> Vec<usize> {
        let sign = self.data[v];
        let mut visited = vec![false; self.size()];
        let mut chain = Vec::new();
        let mut stack = vec![v];
        while let Some(u) = stack.pop() {
            if visited[u] {
                continue;
            }
            visited[u] = true;
            chain.push(u);
            for n in self.neighbors(u) {
                if self.data[n] == sign && !visited[n] {
                    stack.push(n);
                }
            }
        }
        chain
    }

    /// Try to make a pseudo-legal move. Returns Some(captured_vertices) on success,
    /// None if the move is rejected (eye fill, suicide, ko-like recapture).
    fn make_pseudo_move(&mut self, sign: i8, v: usize) -> Option<Vec<usize>> {
        // Reject eye fills: all neighbors are same color or off-board
        let neighbors = self.neighbors(v);
        let all_friendly = neighbors.iter().all(|&n| self.data[n] == sign);
        if all_friendly {
            return None;
        }

        // Place stone
        self.data[v] = sign;

        // Capture opponent chains with 0 liberties
        let opp = -sign;
        let mut captured = Vec::new();
        for &n in &neighbors {
            if self.data[n] == opp {
                let mut vis = vec![false; self.size()];
                if !self.has_liberties(n, &mut vis) {
                    let chain = self.get_chain(n);
                    for &c in &chain {
                        self.data[c] = 0;
                    }
                    captured.extend(chain);
                }
            }
        }

        // Reject suicide (placed stone has no liberties and captured nothing)
        if captured.is_empty() {
            let mut vis = vec![false; self.size()];
            if !self.has_liberties(v, &mut vis) {
                self.data[v] = 0;
                return None;
            }
        }

        // Reject ko-like recaptures: single stone captures single stone AND
        // the capturing stone has exactly 1 liberty (the captured position).
        if captured.len() == 1 {
            let nbrs = self.neighbors(v);
            let is_single = nbrs.iter().all(|&n| self.data[n] != sign);
            let lib_count = nbrs.iter().filter(|&&n| self.data[n] == 0).count();
            if is_single && lib_count == 1 {
                self.data[v] = 0;
                self.data[captured[0]] = opp;
                return None;
            }
        }

        Some(captured)
    }
}

// ---------------------------------------------------------------------------
// Monte Carlo playout
// ---------------------------------------------------------------------------

/// Run a single random playout to completion, returning the final board signs.
fn play_till_end(goban: &Goban, starting_sign: i8, rng: &mut Rng) -> Vec<i8> {
    let mut board = PlayoutBoard::from_goban(goban);
    let size = board.size();

    // Collect playable empty vertices
    let mut empty: Vec<usize> = (0..size).filter(|&i| board.get(i) == 0).collect();

    let mut sign = starting_sign;
    let mut consecutive_passes = 0;

    while consecutive_passes < 2 && !empty.is_empty() {
        // Shuffle empty list (Fisher-Yates partial: try random positions)
        let mut played = false;
        let mut attempts = empty.len();

        while attempts > 0 {
            let idx = rng.range(empty.len());
            let v = empty[idx];

            if board.get(v) != 0 {
                // Vertex no longer empty — remove it
                empty.swap_remove(idx);
                attempts = attempts.saturating_sub(1);
                continue;
            }

            if let Some(_captured) = board.make_pseudo_move(sign, v) {
                empty.swap_remove(idx);
                played = true;
                break;
            }
            attempts -= 1;
        }

        if played {
            consecutive_passes = 0;
        } else {
            consecutive_passes += 1;
        }

        sign = -sign;
    }

    // Patch remaining empty points with neighbor color
    for i in 0..size {
        if board.get(i) == 0 {
            for n in board.neighbors(i) {
                let ns = board.data[n]; // direct access for speed
                if ns != 0 {
                    board.data[i] = ns;
                    break;
                }
            }
        }
    }

    board.data
}

/// Run multiple random playouts and return per-vertex ownership probability.
/// Values range from -1.0 (certainly White) to +1.0 (certainly Black).
fn get_probability_map(goban: &Goban, iterations: usize) -> Vec<f64> {
    let size = goban.cols() as usize * goban.rows() as usize;
    let mut black_wins = vec![0i32; size];
    let mut rng = Rng::new(0x5E41_DEAD);

    for i in 0..iterations {
        let starting_sign = if i % 2 == 0 { 1 } else { -1 };
        let result = play_till_end(goban, starting_sign, &mut rng);
        for (v, &s) in result.iter().enumerate() {
            black_wins[v] += s.signum() as i32;
        }
    }

    black_wins
        .iter()
        .map(|&bw| bw as f64 / iterations as f64)
        .collect()
}

/// Detect dead stones using Benson's algorithm + Monte Carlo random playouts.
///
/// Phase 1 — Benson simplified-board heuristic: builds a board with only
/// Benson-alive stones and estimates territory on it. Non-alive stones sitting
/// in opponent Benson-territory are marked dead.
///
/// Phase 2 — Monte Carlo: runs random playouts and checks the average ownership
/// probability of each non-alive chain's liberties. If the liberties are firmly
/// controlled by the opponent, the chain is dead. Chains with zero liberties
/// (already captured in practice) are also marked dead.
///
/// Benson-alive stones are never marked dead.
pub fn detect_dead_stones(goban: &Goban) -> HashSet<Point> {
    let mut alive = find_unconditionally_alive(goban, Stone::Black);
    let alive_white = find_unconditionally_alive(goban, Stone::White);
    alive.extend(&alive_white);

    let cols = goban.cols();
    let rows = goban.rows();
    let size = cols as usize * rows as usize;

    let prob = get_probability_map(goban, 100);

    // --- Phase 1: Benson simplified-board territory ---
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
        last_move: None,
    });
    let ownership = estimate_territory(&simplified_goban, &HashSet::new());

    let mut dead = HashSet::new();
    for y in 0..rows {
        for x in 0..cols {
            if alive.contains(&(x, y)) {
                continue;
            }
            if let Some(stone) = goban.stone_at((x, y)) {
                let idx = y as usize * cols as usize + x as usize;
                if ownership[idx] == stone.opp().to_int() {
                    let chain = goban.chain((x, y));
                    let liberty_score = chain_liberty_score(goban, &chain, &prob);
                    if (stone.to_int() as f64) * liberty_score <= 0.0 {
                        for pt in chain {
                            dead.insert(pt);
                        }
                    }
                }
            }
        }
    }

    // --- Phase 2: Monte Carlo for remaining chains ---
    let mut visited = vec![false; size];

    for y in 0..rows {
        for x in 0..cols {
            let idx = y as usize * cols as usize + x as usize;
            if visited[idx] {
                continue;
            }

            let stone = match goban.stone_at((x, y)) {
                Some(s) => s,
                None => continue,
            };

            let chain = goban.chain((x, y));
            for &(cx, cy) in &chain {
                visited[cy as usize * cols as usize + cx as usize] = true;
            }

            // Skip Benson-alive or already detected dead
            if chain.iter().any(|pt| alive.contains(pt)) {
                continue;
            }
            if chain.iter().any(|pt| dead.contains(pt)) {
                continue;
            }

            let liberty_score = chain_liberty_score(goban, &chain, &prob);
            let lib_count = chain_liberty_count(goban, &chain);

            // Zero-liberty chain → dead (captured in practice)
            if lib_count == 0 {
                for &pt in &chain {
                    dead.insert(pt);
                }
                continue;
            }

            // Average liberty probability opposes stone color → dead
            let stone_liberty_score = (stone.to_int() as f64) * liberty_score;
            let liberty_regions = chain_liberty_region_count(goban, &chain);
            let eye_regions = chain_eye_region_count(goban, &chain, stone);
            if stone_liberty_score < 0.0
                || (liberty_regions < 2 && stone_liberty_score < 0.1)
                || (lib_count <= 3 && eye_regions < 2 && stone_liberty_score < 0.6)
            {
                for &pt in &chain {
                    dead.insert(pt);
                }
            }
        }
    }

    dead
}

fn chain_liberty_score(goban: &Goban, chain: &[Point], probability: &[f64]) -> f64 {
    let cols = goban.cols();
    let rows = goban.rows();
    let size = cols as usize * rows as usize;
    let mut seen = vec![false; size];
    let mut sum = 0.0;
    let mut count = 0;

    for &(cx, cy) in chain {
        for n in goban.neighbors((cx, cy)) {
            let idx = n.1 as usize * cols as usize + n.0 as usize;
            if goban.stone_at(n).is_none() && !seen[idx] {
                seen[idx] = true;
                sum += probability[idx];
                count += 1;
            }
        }
    }

    if count == 0 { 0.0 } else { sum / count as f64 }
}

fn chain_liberty_count(goban: &Goban, chain: &[Point]) -> usize {
    let cols = goban.cols();
    let rows = goban.rows();
    let size = cols as usize * rows as usize;
    let mut seen = vec![false; size];
    let mut count = 0;

    for &(cx, cy) in chain {
        for n in goban.neighbors((cx, cy)) {
            let idx = n.1 as usize * cols as usize + n.0 as usize;
            if goban.stone_at(n).is_none() && !seen[idx] {
                seen[idx] = true;
                count += 1;
            }
        }
    }

    count
}

fn chain_liberty_region_count(goban: &Goban, chain: &[Point]) -> usize {
    let cols = goban.cols();
    let rows = goban.rows();
    let size = cols as usize * rows as usize;
    let mut liberty_seeds = vec![false; size];

    for &(cx, cy) in chain {
        for n in goban.neighbors((cx, cy)) {
            if goban.stone_at(n).is_none() {
                liberty_seeds[n.1 as usize * cols as usize + n.0 as usize] = true;
            }
        }
    }

    let mut visited = vec![false; size];
    let mut count = 0;

    for idx in 0..size {
        if !liberty_seeds[idx] || visited[idx] {
            continue;
        }

        count += 1;
        let x = (idx % cols as usize) as u8;
        let y = (idx / cols as usize) as u8;
        let mut stack = vec![(x, y)];
        while let Some(point) = stack.pop() {
            let point_idx = point.1 as usize * cols as usize + point.0 as usize;
            if visited[point_idx] {
                continue;
            }
            visited[point_idx] = true;

            for n in goban.neighbors(point) {
                let ni = n.1 as usize * cols as usize + n.0 as usize;
                if goban.stone_at(n).is_none() && !visited[ni] {
                    stack.push(n);
                }
            }
        }
    }

    count
}

fn chain_eye_region_count(goban: &Goban, chain: &[Point], stone: Stone) -> usize {
    let cols = goban.cols();
    let rows = goban.rows();
    let size = cols as usize * rows as usize;
    let chain_set: HashSet<Point> = chain.iter().copied().collect();
    let mut liberty_seeds = vec![false; size];

    for &(cx, cy) in chain {
        for n in goban.neighbors((cx, cy)) {
            if goban.stone_at(n).is_none() {
                liberty_seeds[n.1 as usize * cols as usize + n.0 as usize] = true;
            }
        }
    }

    let mut visited = vec![false; size];
    let mut count = 0;

    for idx in 0..size {
        if !liberty_seeds[idx] || visited[idx] {
            continue;
        }

        let x = (idx % cols as usize) as u8;
        let y = (idx / cols as usize) as u8;
        let mut stack = vec![(x, y)];
        let mut is_eye = true;

        while let Some(point) = stack.pop() {
            let point_idx = point.1 as usize * cols as usize + point.0 as usize;
            if visited[point_idx] {
                continue;
            }
            visited[point_idx] = true;

            for n in goban.neighbors(point) {
                let ni = n.1 as usize * cols as usize + n.0 as usize;
                match goban.stone_at(n) {
                    None if !visited[ni] => stack.push(n),
                    Some(neighbor_stone) if neighbor_stone == stone && chain_set.contains(&n) => {}
                    Some(_) => is_eye = false,
                    None => {}
                }
            }
        }

        if is_eye {
            count += 1;
        }
    }

    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Engine;
    use crate::territory::score;

    fn play(engine: &mut Engine, stone: Stone, point: Point) {
        engine.try_play(stone, point).expect("legal move");
    }

    fn bot_false_eye_position() -> Engine {
        let mut engine = Engine::new(9, 9);
        for (stone, point) in [
            (Stone::Black, (4, 4)),
            (Stone::White, (2, 4)),
            (Stone::Black, (5, 6)),
            (Stone::White, (6, 2)),
            (Stone::Black, (4, 2)),
            (Stone::White, (6, 4)),
            (Stone::Black, (2, 6)),
            (Stone::White, (2, 2)),
            (Stone::Black, (1, 3)),
            (Stone::White, (2, 3)),
            (Stone::Black, (1, 5)),
            (Stone::White, (4, 5)),
            (Stone::Black, (3, 5)),
            (Stone::White, (5, 5)),
            (Stone::Black, (3, 4)),
            (Stone::White, (4, 6)),
            (Stone::Black, (6, 1)),
            (Stone::White, (1, 4)),
            (Stone::Black, (0, 4)),
            (Stone::White, (2, 5)),
            (Stone::Black, (1, 6)),
            (Stone::White, (3, 6)),
            (Stone::Black, (3, 1)),
            (Stone::White, (2, 1)),
            (Stone::Black, (5, 3)),
            (Stone::White, (6, 3)),
            (Stone::Black, (5, 1)),
            (Stone::White, (0, 5)),
            (Stone::Black, (7, 2)),
            (Stone::White, (7, 3)),
            (Stone::Black, (7, 1)),
            (Stone::White, (3, 7)),
            (Stone::Black, (2, 7)),
            (Stone::White, (3, 0)),
            (Stone::Black, (4, 0)),
            (Stone::White, (2, 0)),
            (Stone::Black, (0, 6)),
            (Stone::White, (1, 2)),
            (Stone::Black, (0, 3)),
            (Stone::White, (3, 2)),
            (Stone::Black, (4, 1)),
            (Stone::White, (5, 4)),
            (Stone::Black, (4, 3)),
            (Stone::White, (0, 2)),
            (Stone::Black, (0, 5)),
            (Stone::White, (8, 2)),
            (Stone::Black, (8, 1)),
            (Stone::White, (8, 3)),
            (Stone::Black, (7, 0)),
            (Stone::White, (5, 2)),
        ] {
            play(&mut engine, stone, point);
        }
        engine
    }

    fn bot_large_black_live_position() -> Engine {
        let mut engine = Engine::new(9, 9);
        for (stone, point) in [
            (Stone::Black, (3, 3)),
            (Stone::White, (5, 5)),
            (Stone::Black, (5, 4)),
            (Stone::White, (3, 5)),
            (Stone::Black, (6, 5)),
            (Stone::White, (6, 4)),
            (Stone::Black, (5, 3)),
            (Stone::White, (7, 5)),
            (Stone::Black, (6, 6)),
            (Stone::White, (6, 3)),
            (Stone::Black, (4, 5)),
            (Stone::White, (5, 6)),
            (Stone::Black, (4, 6)),
            (Stone::White, (5, 7)),
            (Stone::Black, (7, 6)),
            (Stone::White, (4, 7)),
            (Stone::Black, (3, 6)),
            (Stone::White, (3, 4)),
            (Stone::Black, (4, 4)),
            (Stone::White, (2, 3)),
            (Stone::Black, (7, 4)),
            (Stone::White, (7, 3)),
            (Stone::Black, (8, 5)),
            (Stone::White, (5, 2)),
            (Stone::Black, (4, 2)),
            (Stone::White, (5, 1)),
            (Stone::Black, (2, 2)),
            (Stone::White, (2, 6)),
            (Stone::Black, (3, 7)),
            (Stone::White, (2, 7)),
            (Stone::Black, (2, 5)),
            (Stone::White, (3, 8)),
            (Stone::Black, (2, 4)),
            (Stone::White, (1, 5)),
            (Stone::Black, (1, 4)),
            (Stone::White, (0, 5)),
            (Stone::Black, (2, 8)),
            (Stone::White, (1, 8)),
            (Stone::Black, (0, 7)),
            (Stone::White, (4, 1)),
            (Stone::Black, (7, 1)),
            (Stone::White, (7, 2)),
            (Stone::Black, (3, 1)),
            (Stone::White, (6, 1)),
            (Stone::Black, (4, 0)),
            (Stone::White, (7, 0)),
            (Stone::Black, (6, 7)),
            (Stone::White, (5, 0)),
            (Stone::Black, (3, 0)),
            (Stone::White, (8, 3)),
            (Stone::Black, (8, 1)),
            (Stone::White, (8, 2)),
            (Stone::Black, (8, 4)),
            (Stone::White, (8, 0)),
            (Stone::Black, (5, 8)),
        ] {
            play(&mut engine, stone, point);
        }
        engine
    }

    fn bot_bottom_black_only_live_position() -> Engine {
        let mut engine = Engine::new(9, 9);
        for (stone, point) in [
            (Stone::Black, (3, 5)),
            (Stone::White, (5, 3)),
            (Stone::Black, (3, 3)),
            (Stone::White, (5, 5)),
            (Stone::Black, (4, 1)),
            (Stone::White, (2, 3)),
            (Stone::Black, (2, 2)),
            (Stone::White, (5, 1)),
            (Stone::Black, (4, 2)),
            (Stone::White, (2, 4)),
            (Stone::Black, (2, 5)),
            (Stone::White, (3, 4)),
            (Stone::Black, (4, 5)),
            (Stone::White, (4, 4)),
            (Stone::Black, (4, 3)),
            (Stone::White, (5, 6)),
            (Stone::Black, (3, 7)),
            (Stone::White, (5, 2)),
            (Stone::Black, (5, 0)),
            (Stone::White, (1, 2)),
            (Stone::Black, (1, 1)),
            (Stone::White, (2, 1)),
            (Stone::Black, (3, 2)),
            (Stone::White, (1, 3)),
            (Stone::Black, (3, 1)),
            (Stone::White, (2, 0)),
            (Stone::Black, (1, 0)),
            (Stone::White, (0, 1)),
            (Stone::Black, (3, 0)),
            (Stone::White, (6, 1)),
            (Stone::Black, (5, 7)),
            (Stone::White, (6, 7)),
            (Stone::Black, (4, 7)),
            (Stone::White, (1, 5)),
            (Stone::Black, (1, 6)),
            (Stone::White, (0, 6)),
            (Stone::Black, (1, 7)),
            (Stone::White, (6, 8)),
            (Stone::Black, (5, 8)),
            (Stone::White, (0, 7)),
            (Stone::Black, (2, 8)),
            (Stone::White, (4, 6)),
            (Stone::Black, (3, 6)),
            (Stone::White, (6, 6)),
        ] {
            play(&mut engine, stone, point);
        }
        engine
    }

    fn bot_lonely_left_black_dead_position() -> Engine {
        let mut engine = Engine::new(9, 9);
        for (stone, point) in [
            (Stone::Black, (5, 4)),
            (Stone::White, (3, 4)),
            (Stone::Black, (4, 2)),
            (Stone::White, (4, 6)),
            (Stone::Black, (6, 6)),
            (Stone::White, (2, 2)),
            (Stone::Black, (2, 6)),
            (Stone::White, (5, 3)),
            (Stone::Black, (6, 2)),
            (Stone::White, (4, 4)),
            (Stone::Black, (6, 4)),
            (Stone::White, (5, 2)),
            (Stone::Black, (5, 1)),
            (Stone::White, (4, 3)),
            (Stone::Black, (6, 3)),
            (Stone::White, (3, 6)),
            (Stone::Black, (2, 7)),
            (Stone::White, (1, 5)),
            (Stone::Black, (5, 7)),
            (Stone::White, (4, 7)),
            (Stone::Black, (4, 8)),
            (Stone::White, (3, 8)),
            (Stone::Black, (5, 8)),
            (Stone::White, (3, 7)),
            (Stone::Black, (3, 1)),
            (Stone::White, (2, 1)),
            (Stone::Black, (3, 2)),
            (Stone::White, (3, 0)),
            (Stone::Black, (4, 0)),
            (Stone::White, (2, 0)),
            (Stone::Black, (6, 1)),
            (Stone::White, (5, 6)),
            (Stone::Black, (6, 7)),
            (Stone::White, (3, 3)),
            (Stone::Black, (4, 1)),
            (Stone::White, (5, 5)),
            (Stone::Black, (6, 5)),
            (Stone::White, (2, 5)),
        ] {
            play(&mut engine, stone, point);
        }
        engine
    }

    #[test]
    fn bot_false_eye_position_marks_left_black_group_dead() {
        let engine = bot_false_eye_position();
        let dead = detect_dead_stones(engine.goban());
        let expected_dead_black: HashSet<Point> = [
            (0, 3),
            (0, 4),
            (0, 5),
            (0, 6),
            (1, 3),
            (1, 5),
            (1, 6),
            (2, 6),
            (2, 7),
            (5, 6),
        ]
        .into_iter()
        .collect();

        assert_eq!(dead, expected_dead_black);

        let ownership = estimate_territory(engine.goban(), &dead);
        let final_score = score(engine.goban(), &ownership, &dead, 6.5);

        assert_eq!(final_score.black.territory, 3);
    }

    #[test]
    fn bot_large_black_live_position_keeps_black_alive() {
        let engine = bot_large_black_live_position();
        let dead = detect_dead_stones(engine.goban());

        for point in [(4, 4), (5, 4), (6, 5), (6, 6), (6, 7)] {
            assert!(!dead.contains(&point), "expected {point:?} to be alive");
        }
    }

    #[test]
    fn bot_bottom_black_only_live_position_marks_upper_black_dead() {
        let engine = bot_bottom_black_only_live_position();
        let dead = detect_dead_stones(engine.goban());

        for point in [(1, 0), (3, 0), (3, 2), (4, 2), (5, 0)] {
            assert!(dead.contains(&point), "expected {point:?} to be dead");
        }

        for point in [(2, 5), (3, 5), (3, 7), (4, 7), (5, 8)] {
            assert!(!dead.contains(&point), "expected {point:?} to be alive");
        }

        let ownership = estimate_territory(engine.goban(), &dead);
        let final_score = score(engine.goban(), &ownership, &dead, 6.5);
        assert!(final_score.white_total() > final_score.black_total());
    }

    #[test]
    fn bot_lonely_left_black_dead_position_keeps_bottom_white_alive() {
        let engine = bot_lonely_left_black_dead_position();
        let dead = detect_dead_stones(engine.goban());

        assert!(dead.contains(&(2, 6)));
        assert!(dead.contains(&(2, 7)));

        for point in [(3, 6), (3, 7), (3, 8), (4, 6), (4, 7), (5, 5), (5, 6)] {
            assert!(!dead.contains(&point), "expected {point:?} to be alive");
        }

        for point in [(4, 0), (4, 1), (5, 7), (5, 8), (6, 5), (6, 6)] {
            assert!(!dead.contains(&point), "expected {point:?} to be alive");
        }
    }
}
