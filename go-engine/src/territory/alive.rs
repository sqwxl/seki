use std::collections::HashSet;

use crate::Point;
use crate::goban::Goban;
use crate::stone::Stone;

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
