use super::error::SgfError;
use super::properties::*;
use super::types::*;

pub(crate) fn convert_property(ident: String, values: Vec<String>) -> Result<Property, SgfError> {
    let prop = match ident.as_str() {
        // -- Move --
        "B" => Property::Black(parse_move_point(&values, &ident)?),
        "W" => Property::White(parse_move_point(&values, &ident)?),
        "KO" => Property::Ko,
        "MN" => Property::MoveNumber(parse_u32(&values, &ident)?),

        // -- Setup --
        "AB" => Property::AddBlack(parse_point_list(&values, &ident)?),
        "AW" => Property::AddWhite(parse_point_list(&values, &ident)?),
        "AE" => Property::AddEmpty(parse_point_list(&values, &ident)?),
        "PL" => Property::PlayerToPlay(parse_color(&values, &ident)?),

        // -- Root --
        "FF" => Property::FileFormat(parse_u8(&values, &ident)?),
        "GM" => Property::GameType(parse_u8(&values, &ident)?),
        "SZ" => parse_sz(&values)?,
        "AP" => parse_ap(&values)?,
        "CA" => Property::CharacterSet(one_value(&values, &ident)?),
        "ST" => Property::Style(parse_u8(&values, &ident)?),

        // -- Game info (all simple text) --
        "PB" => Property::BlackName(one_value(&values, &ident)?),
        "PW" => Property::WhiteName(one_value(&values, &ident)?),
        "BR" => Property::BlackRank(one_value(&values, &ident)?),
        "WR" => Property::WhiteRank(one_value(&values, &ident)?),
        "BT" => Property::BlackTeam(one_value(&values, &ident)?),
        "WT" => Property::WhiteTeam(one_value(&values, &ident)?),
        "EV" => Property::EventName(one_value(&values, &ident)?),
        "RO" => Property::Round(one_value(&values, &ident)?),
        "DT" => Property::Date(one_value(&values, &ident)?),
        "PC" => Property::Place(one_value(&values, &ident)?),
        "RU" => Property::Rules(one_value(&values, &ident)?),
        "RE" => Property::Result(one_value(&values, &ident)?),
        "TM" => Property::TimeLimitSeconds(parse_f64(&values, &ident)?),
        "OT" => Property::OvertimeDescription(one_value(&values, &ident)?),
        "GN" => Property::GameName(one_value(&values, &ident)?),
        "GC" => Property::GameComment(one_value(&values, &ident)?),
        "ON" => Property::Opening(one_value(&values, &ident)?),
        "SO" => Property::Source(one_value(&values, &ident)?),
        "CP" => Property::Copyright(one_value(&values, &ident)?),
        "US" => Property::User(one_value(&values, &ident)?),
        "AN" => Property::Annotator(one_value(&values, &ident)?),

        // -- Go-specific --
        "HA" => Property::Handicap(parse_u8(&values, &ident)?),
        "KM" => Property::Komi(parse_f64(&values, &ident)?),
        "TB" => Property::TerritoryBlack(parse_point_list(&values, &ident)?),
        "TW" => Property::TerritoryWhite(parse_point_list(&values, &ident)?),

        // -- Annotation --
        "C" => Property::Comment(one_value(&values, &ident)?),
        "N" => Property::NodeName(one_value(&values, &ident)?),
        "V" => Property::NodeValue(parse_f64(&values, &ident)?),
        "DM" => Property::EvenPosition(parse_double(&values, &ident)?),
        "GB" => Property::GoodForBlack(parse_double(&values, &ident)?),
        "GW" => Property::GoodForWhite(parse_double(&values, &ident)?),
        "UC" => Property::UnclearPosition(parse_double(&values, &ident)?),
        "HO" => Property::Hotspot(parse_double(&values, &ident)?),

        // -- Move annotation --
        "BM" => Property::BadMove(parse_double(&values, &ident)?),
        "TE" => Property::Tesuji(parse_double(&values, &ident)?),
        "DO" => Property::DoubtfulMove,
        "IT" => Property::InterestingMove,

        // -- Markup --
        "AR" => Property::Arrows(parse_point_pair_list(&values, &ident)?),
        "CR" => Property::Circles(parse_point_list(&values, &ident)?),
        "MA" => Property::XMarks(parse_point_list(&values, &ident)?),
        "TR" => Property::Triangles(parse_point_list(&values, &ident)?),
        "SQ" => Property::Squares(parse_point_list(&values, &ident)?),
        "SL" => Property::SelectedPoints(parse_point_list(&values, &ident)?),
        "LB" => Property::Labels(parse_label_list(&values, &ident)?),
        "LN" => Property::Lines(parse_point_pair_list(&values, &ident)?),
        "DD" => Property::DimPoints(parse_point_list(&values, &ident)?),

        // -- Timing --
        "BL" => Property::BlackTime(parse_f64(&values, &ident)?),
        "WL" => Property::WhiteTime(parse_f64(&values, &ident)?),
        "OB" => Property::BlackOvertimePeriods(parse_u32(&values, &ident)?),
        "OW" => Property::WhiteOvertimePeriods(parse_u32(&values, &ident)?),

        // -- Misc --
        "FG" => parse_fg(&values)?,
        "PM" => Property::PrintMoveMode(parse_u32(&values, &ident)?),
        "VW" => Property::View(parse_point_list(&values, &ident)?),

        // -- Unknown --
        _ => Property::Unknown(ident, values),
    };
    Ok(prop)
}
