use crate::Point;

/// Returns the maximum number of handicap stones for a given board size.
pub fn max_handicap(cols: u8, rows: u8) -> u8 {
    if cols != rows || cols < 7 || cols.is_multiple_of(2) {
        return 0;
    }
    if cols >= 13 {
        9
    } else {
        // Boards smaller than 13: only corners + center (no side hoshi)
        5
    }
}

/// Hoshi-based handicap stone placement for any odd square board ≥ 7.
///
/// Returns `None` if the board is non-square, even, too small, or count is invalid.
pub fn handicap_points(cols: u8, rows: u8, count: u8) -> Option<Vec<Point>> {
    if cols != rows || cols < 7 || cols.is_multiple_of(2) || count < 2 || count > max_handicap(cols, rows) {
        return None;
    }

    // Hoshi offset from edge: 3 for boards ≥ 13, 2 for smaller
    let off = if cols >= 13 { 3 } else { 2 };
    let far = cols - 1 - off;
    let mid = cols / 2;

    let tl = (off, off);
    let tr = (far, off);
    let bl = (off, far);
    let br = (far, far);
    let cc = (mid, mid);

    let ml = (off, mid);
    let mr = (far, mid);
    let tc = (mid, off);
    let bc = (mid, far);

    let pts = match count {
        2 => vec![tr, bl],
        3 => vec![tr, bl, br],
        4 => vec![tl, tr, bl, br],
        5 => vec![tl, tr, bl, br, cc],
        6 => vec![tl, tr, ml, mr, bl, br],
        7 => vec![tl, tr, ml, mr, bl, br, cc],
        8 => vec![tl, tr, ml, mr, bl, br, tc, bc],
        9 => vec![tl, tr, ml, mr, bl, br, tc, bc, cc],
        _ => unreachable!(),
    };

    Some(pts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_for_invalid_boards() {
        assert!(handicap_points(4, 4, 2).is_none()); // too small
        assert!(handicap_points(5, 5, 2).is_none()); // too small
        assert!(handicap_points(6, 6, 2).is_none()); // even
        assert!(handicap_points(9, 13, 2).is_none()); // non-square
    }

    #[test]
    fn returns_none_for_invalid_count() {
        assert!(handicap_points(19, 19, 0).is_none());
        assert!(handicap_points(19, 19, 1).is_none());
        assert!(handicap_points(19, 19, 10).is_none());
        assert!(handicap_points(9, 9, 6).is_none()); // max 5 on 9x9
    }

    #[test]
    fn max_handicap_by_size() {
        assert_eq!(max_handicap(5, 5), 0);
        assert_eq!(max_handicap(7, 7), 5);
        assert_eq!(max_handicap(9, 9), 5);
        assert_eq!(max_handicap(11, 11), 5);
        assert_eq!(max_handicap(13, 13), 9);
        assert_eq!(max_handicap(15, 15), 9);
        assert_eq!(max_handicap(19, 19), 9);
        assert_eq!(max_handicap(4, 4), 0);
        assert_eq!(max_handicap(6, 6), 0);
        assert_eq!(max_handicap(9, 13), 0);
    }

    #[test]
    fn returns_correct_count_19x19() {
        for n in 2..=9 {
            let pts = handicap_points(19, 19, n).unwrap();
            assert_eq!(pts.len(), n as usize, "handicap {n} should have {n} points");
        }
    }

    #[test]
    fn nineteen_hoshi_positions() {
        let pts = handicap_points(19, 19, 9).unwrap();
        let expected = vec![
            (3, 3),
            (15, 3),
            (3, 9),
            (15, 9),
            (3, 15),
            (15, 15),
            (9, 3),
            (9, 15),
            (9, 9),
        ];
        for p in &expected {
            assert!(pts.contains(p), "19x19: missing hoshi {p:?}");
        }
    }

    #[test]
    fn thirteen_hoshi_positions() {
        let pts = handicap_points(13, 13, 9).unwrap();
        let expected = vec![
            (3, 3),
            (9, 3),
            (3, 6),
            (9, 6),
            (3, 9),
            (9, 9),
            (6, 3),
            (6, 9),
            (6, 6),
        ];
        for p in &expected {
            assert!(pts.contains(p), "13x13: missing hoshi {p:?}");
        }
    }

    #[test]
    fn nine_hoshi_positions() {
        let pts = handicap_points(9, 9, 5).unwrap();
        let expected = vec![(2, 2), (6, 2), (2, 6), (6, 6), (4, 4)];
        for p in &expected {
            assert!(pts.contains(p), "9x9: missing hoshi {p:?}");
        }
    }

    #[test]
    fn seven_by_seven() {
        // off=2, far=4, mid=3
        let pts = handicap_points(7, 7, 5).unwrap();
        let expected = vec![(2, 2), (4, 2), (2, 4), (4, 4), (3, 3)];
        for p in &expected {
            assert!(pts.contains(p), "7x7: missing hoshi {p:?}");
        }
    }
}
