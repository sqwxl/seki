use crate::Point;

/// Standard 19×19 hoshi (star point) positions used for handicap stone placement.
///
/// Returns `None` if `count` is outside 2–9 or the board is not 19×19.
pub fn handicap_points(cols: u8, rows: u8, count: u8) -> Option<Vec<Point>> {
    if cols != 19 || rows != 19 || count < 2 || count > 9 {
        return None;
    }

    // Corners
    let tl = (3, 3); // top-left
    let tr = (15, 3); // top-right
    let bl = (3, 15); // bottom-left
    let br = (15, 15); // bottom-right

    // Sides
    let ml = (3, 9); // mid-left
    let mr = (15, 9); // mid-right
    let tc = (9, 3); // top-center
    let bc = (9, 15); // bottom-center

    // Center
    let cc = (9, 9);

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
    fn returns_none_for_non_19x19() {
        assert!(handicap_points(9, 9, 2).is_none());
        assert!(handicap_points(13, 13, 2).is_none());
    }

    #[test]
    fn returns_none_for_invalid_count() {
        assert!(handicap_points(19, 19, 0).is_none());
        assert!(handicap_points(19, 19, 1).is_none());
        assert!(handicap_points(19, 19, 10).is_none());
    }

    #[test]
    fn returns_correct_count() {
        for n in 2..=9 {
            let pts = handicap_points(19, 19, n).unwrap();
            assert_eq!(pts.len(), n as usize, "handicap {n} should have {n} points");
        }
    }

    #[test]
    fn two_stones_are_diagonal_corners() {
        let pts = handicap_points(19, 19, 2).unwrap();
        assert_eq!(pts, vec![(15, 3), (3, 15)]);
    }

    #[test]
    fn four_stones_are_all_corners() {
        let pts = handicap_points(19, 19, 4).unwrap();
        assert!(pts.contains(&(3, 3)));
        assert!(pts.contains(&(15, 3)));
        assert!(pts.contains(&(3, 15)));
        assert!(pts.contains(&(15, 15)));
    }

    #[test]
    fn five_includes_center() {
        let pts = handicap_points(19, 19, 5).unwrap();
        assert!(pts.contains(&(9, 9)));
    }

    #[test]
    fn nine_uses_all_hoshi() {
        let pts = handicap_points(19, 19, 9).unwrap();
        assert_eq!(pts.len(), 9);
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
            assert!(pts.contains(p), "missing hoshi point {p:?}");
        }
    }
}
