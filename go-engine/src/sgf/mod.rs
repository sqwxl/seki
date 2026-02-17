mod error;
mod parser;
mod serialize;
pub mod types;

pub use error::SgfError;
pub use parser::parse;
pub use serialize::serialize;
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_simple_game() {
        let input = "(;FF[4]GM[1]SZ[19]PB[Alice]PW[Bob]KM[6.5];B[pd];W[dd];B[pp];W[dp])";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_with_variations() {
        let input = "(;FF[4]GM[1]SZ[9];B[ee](;W[ge];B[dg])(;W[de];B[fg]))";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_with_setup() {
        let input = "(;FF[4]GM[1]SZ[9]AB[dd][df][fd]AW[ee][eg])";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_with_comments_and_escapes() {
        let input = r"(;C[This has a \] bracket and a \\ backslash])";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_pass_moves() {
        let input = "(;B[dd];W[];B[])";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_rectangular_board() {
        let input = "(;SZ[19:13];B[aa])";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_unknown_properties() {
        let input = "(;FF[4]XX[foo][bar])";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_markup() {
        let input = "(;TR[aa][bb]CR[cc]MA[dd]SQ[ee]LB[ff:A][gg:B])";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_game_info() {
        let input = "(;FF[4]GM[1]SZ[19]PB[Lee Sedol]PW[AlphaGo]BR[9p]WR[9p]RE[W+R]EV[Google DeepMind Challenge]DT[2016-03-09]KM[7.5]RU[Chinese]TM[7200])";
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }

    #[test]
    fn round_trip_real_game_fragment() {
        // A simplified but realistic SGF fragment
        let input = concat!(
            "(;FF[4]GM[1]SZ[19]",
            "PB[Honinbo Shusaku]PW[Gennan Inseki]",
            "RE[B+2]KM[0]HA[0]",
            ";B[qd];W[dc];B[pq];W[cp]",
            ";B[ce];W[ed];B[cf]",
            "C[A classic opening]",
            ";W[oc])",
        );
        let collection = parse(input).unwrap();
        let output = serialize(&collection);
        let reparsed = parse(&output).unwrap();
        assert_eq!(collection, reparsed);
    }
}
