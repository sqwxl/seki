use crate::Point;
use crate::goban::Goban;
use crate::stone::Stone;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AreaOptions {
    pub non_pass_alive_stones: bool,
    pub safe_big_territories: bool,
    pub unsafe_big_territories: bool,
}

#[derive(Debug)]
struct Chain {
    points: Vec<Point>,
}

#[derive(Debug)]
struct Region {
    points: Vec<Point>,
    bordering_chains: Vec<usize>,
    vital_chains: Vec<usize>,
    internal_spaces_max_2: u8,
    contains_opp: bool,
    borders_non_pass_alive: bool,
}

pub fn calculate_area(goban: &Goban, options: AreaOptions) -> Vec<i8> {
    let mut result = vec![0; board_len(goban)];
    let black = calculate_area_for_player(goban, Stone::Black, options);
    let white = calculate_area_for_player(goban, Stone::White, options);

    for i in 0..result.len() {
        match (black[i], white[i]) {
            (b, 0) => result[i] = b,
            (0, w) => result[i] = w,
            _ => {}
        }
    }

    if options.non_pass_alive_stones {
        for (i, &stone) in goban.board().iter().enumerate() {
            if result[i] == 0 {
                result[i] = stone.signum();
            }
        }
    }

    result
}

fn calculate_area_for_player(goban: &Goban, pla: Stone, options: AreaOptions) -> Vec<i8> {
    let mut result = vec![0; board_len(goban)];
    let (chains, chain_by_point) = collect_chains(goban, pla);
    if chains.is_empty() {
        return result;
    }

    let mut regions = collect_regions(goban, pla, &chain_by_point);
    let mut region_by_chain = vec![Vec::new(); chains.len()];
    for (region_idx, region) in regions.iter().enumerate() {
        for &chain_idx in &region.bordering_chains {
            region_by_chain[chain_idx].push(region_idx);
        }
    }

    let mut chain_alive = vec![true; chains.len()];
    let mut vital_counts = vec![0usize; chains.len()];
    for region in &regions {
        for &chain_idx in &region.vital_chains {
            vital_counts[chain_idx] += 1;
        }
    }

    let mut pending: Vec<usize> = vital_counts
        .iter()
        .enumerate()
        .filter_map(|(idx, &count)| (count < 2).then_some(idx))
        .collect();

    while let Some(chain_idx) = pending.pop() {
        if !chain_alive[chain_idx] {
            continue;
        }
        chain_alive[chain_idx] = false;

        for &region_idx in &region_by_chain[chain_idx] {
            if regions[region_idx].borders_non_pass_alive {
                continue;
            }
            regions[region_idx].borders_non_pass_alive = true;

            for &vital_chain_idx in &regions[region_idx].vital_chains {
                if !chain_alive[vital_chain_idx] || vital_counts[vital_chain_idx] == 0 {
                    continue;
                }
                vital_counts[vital_chain_idx] -= 1;
                if vital_counts[vital_chain_idx] < 2 {
                    pending.push(vital_chain_idx);
                }
            }
        }
    }

    for (chain_idx, chain) in chains.iter().enumerate() {
        if !chain_alive[chain_idx] {
            continue;
        }
        for &point in &chain.points {
            result[point_idx(goban, point)] = pla.to_int();
        }
    }

    for region in regions {
        let borders_alive_chain = region
            .bordering_chains
            .iter()
            .any(|&chain_idx| chain_alive[chain_idx]);
        let is_strict_eye_space =
            region.internal_spaces_max_2 <= 1 && !region.borders_non_pass_alive;
        let is_big_territory = borders_alive_chain
            && !region.borders_non_pass_alive
            && !region.contains_opp
            && (options.safe_big_territories || options.unsafe_big_territories);

        if borders_alive_chain && (is_strict_eye_space || is_big_territory) {
            for point in region.points {
                result[point_idx(goban, point)] = pla.to_int();
            }
        }
    }

    result
}

fn collect_chains(goban: &Goban, pla: Stone) -> (Vec<Chain>, Vec<usize>) {
    let mut visited = vec![false; board_len(goban)];
    let mut chain_by_point = vec![usize::MAX; board_len(goban)];
    let mut chains = Vec::new();

    for row in 0..goban.rows() {
        for col in 0..goban.cols() {
            let point = (col, row);
            let idx = point_idx(goban, point);
            if visited[idx] || goban.stone_at(point) != Some(pla) {
                continue;
            }

            let points = goban.chain_from(point, &mut visited);
            let chain_idx = chains.len();
            for &chain_point in &points {
                chain_by_point[point_idx(goban, chain_point)] = chain_idx;
            }
            chains.push(Chain { points });
        }
    }

    (chains, chain_by_point)
}

fn collect_regions(goban: &Goban, pla: Stone, chain_by_point: &[usize]) -> Vec<Region> {
    let mut visited = vec![false; board_len(goban)];
    let mut regions = Vec::new();

    for row in 0..goban.rows() {
        for col in 0..goban.cols() {
            let point = (col, row);
            let idx = point_idx(goban, point);
            if visited[idx] || goban.stone_at(point) == Some(pla) {
                continue;
            }

            regions.push(collect_region(
                goban,
                pla,
                point,
                &mut visited,
                chain_by_point,
            ));
        }
    }

    regions
}

fn collect_region(
    goban: &Goban,
    pla: Stone,
    start: Point,
    visited: &mut [bool],
    chain_by_point: &[usize],
) -> Region {
    let mut points = Vec::new();
    let mut empty_points = Vec::new();
    let mut bordering_chains = Vec::new();
    let mut stack = vec![start];
    let mut contains_opp = false;
    let mut internal_spaces_max_2 = 0;

    while let Some(point) = stack.pop() {
        let idx = point_idx(goban, point);
        if visited[idx] {
            continue;
        }
        visited[idx] = true;
        points.push(point);

        match goban.stone_at(point) {
            Some(stone) if stone == pla.opp() => contains_opp = true,
            None => {
                empty_points.push(point);
                if internal_spaces_max_2 < 2
                    && !goban
                        .neighbors(point)
                        .iter()
                        .any(|&neighbor| goban.stone_at(neighbor) == Some(pla))
                {
                    internal_spaces_max_2 += 1;
                }
            }
            _ => {}
        }

        for neighbor in goban.neighbors(point) {
            let neighbor_idx = point_idx(goban, neighbor);
            if goban.stone_at(neighbor) == Some(pla) {
                push_unique(&mut bordering_chains, chain_by_point[neighbor_idx]);
            } else if !visited[neighbor_idx] {
                stack.push(neighbor);
            }
        }
    }

    let vital_chains = find_vital_chains(goban, &empty_points, &bordering_chains, chain_by_point);

    Region {
        points,
        bordering_chains,
        vital_chains,
        internal_spaces_max_2,
        contains_opp,
        borders_non_pass_alive: false,
    }
}

fn find_vital_chains(
    goban: &Goban,
    empty_points: &[Point],
    bordering_chains: &[usize],
    chain_by_point: &[usize],
) -> Vec<usize> {
    if empty_points.is_empty() {
        return Vec::new();
    }

    bordering_chains
        .iter()
        .copied()
        .filter(|&chain_idx| {
            empty_points.iter().all(|&point| {
                goban
                    .neighbors(point)
                    .iter()
                    .any(|&neighbor| chain_by_point[point_idx(goban, neighbor)] == chain_idx)
            })
        })
        .collect()
}

fn push_unique(values: &mut Vec<usize>, value: usize) {
    if value != usize::MAX && !values.contains(&value) {
        values.push(value);
    }
}

fn board_len(goban: &Goban) -> usize {
    goban.cols() as usize * goban.rows() as usize
}

fn point_idx(goban: &Goban, (col, row): Point) -> usize {
    row as usize * goban.cols() as usize + col as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::goban_from_layout;

    #[test]
    fn marks_two_eye_chain_as_pass_alive() {
        let goban = goban_from_layout(&[
            "BBBBB", //
            "B+B+B", //
            "BBBBB",
        ]);

        let area = calculate_area(&goban, AreaOptions::default());

        assert_eq!(area, vec![1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    }

    #[test]
    fn one_eye_chain_is_not_pass_alive() {
        let goban = goban_from_layout(&[
            "BBB", //
            "B+B", //
            "BBB",
        ]);

        let area = calculate_area(&goban, AreaOptions::default());

        assert_eq!(area, vec![0; 9]);
    }

    #[test]
    fn opponent_stones_inside_eye_space_prevent_territory_marking() {
        let goban = goban_from_layout(&[
            "BBBBB", //
            "BWB+B", //
            "BBBBB",
        ]);

        let area = calculate_area(&goban, AreaOptions::default());

        assert_eq!(area[point_idx(&goban, (1, 1))], 0);
        assert_eq!(area[point_idx(&goban, (3, 1))], 0);
    }
}
