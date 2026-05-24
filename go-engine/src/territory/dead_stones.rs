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
                    dead.insert((x, y));
                }
            }
        }
    }

    // --- Phase 2: Monte Carlo for remaining chains ---
    let prob = get_probability_map(goban, 100);
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

            // Collect unique liberty vertices for this chain
            let mut lib_seen = vec![false; size];
            let mut lib_prob_sum = 0.0;
            let mut lib_count = 0;
            for &(cx, cy) in &chain {
                for n in goban.neighbors((cx, cy)) {
                    let ni = n.1 as usize * cols as usize + n.0 as usize;
                    if goban.stone_at(n).is_none() && !lib_seen[ni] {
                        lib_seen[ni] = true;
                        lib_prob_sum += prob[ni];
                        lib_count += 1;
                    }
                }
            }

            // Zero-liberty chain → dead (captured in practice)
            if lib_count == 0 {
                for &pt in &chain {
                    dead.insert(pt);
                }
                continue;
            }

            // Average liberty probability opposes stone color → dead
            let avg_lib_prob = lib_prob_sum / lib_count as f64;
            let stone_sign = stone.to_int() as f64;
            if stone_sign * avg_lib_prob < 0.0 {
                for &pt in &chain {
                    dead.insert(pt);
                }
            }
        }
    }

    dead
}
