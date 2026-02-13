use crate::Point;
use crate::Stone;

/// A collection of game trees — an SGF file can contain multiple games.
pub type Collection = Vec<GameTree>;

/// A game tree: a sequence of nodes followed by zero or more variations.
#[derive(Debug, Clone, PartialEq)]
pub struct GameTree {
    pub nodes: Vec<Node>,
    pub variations: Vec<GameTree>,
}

/// A single node in the game tree, containing one or more properties.
#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub properties: Vec<Property>,
}

/// SGF Double value (used for annotations like "good for black").
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Double {
    Normal = 1,
    Emphasized = 2,
}

/// A labeled point: a point with a text label (used in LB[]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Label {
    pub point: Point,
    pub text: String,
}

/// A line or arrow between two points (used in LN[], AR[]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PointPair {
    pub from: Point,
    pub to: Point,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Property {
    Black(Option<Point>),
    White(Option<Point>),
    Ko,
    MoveNumber(u32),

    AddBlack(Vec<Point>),
    AddWhite(Vec<Point>),
    AddEmpty(Vec<Point>),
    PlayerToPlay(Stone),

    FileFormat(u8),
    GameType(u8),
    BoardSize(u8, u8),
    ApplicationNameVersion(String, String),
    CharacterSet(String),
    Style(u8),

    BlackName(String),
    WhiteName(String),
    BlackRank(String),
    WhiteRank(String),
    BlackTeam(String),
    WhiteTeam(String),
    EventName(String),
    Round(String),
    Date(String),
    Place(String),
    Rules(String),
    /// (e.g. "B+2.5", "W+R").
    Result(String),
    TimeLimitSeconds(f64),
    OvertimeDescription(String),
    GameName(String),
    GameComment(String),
    Opening(String),
    Source(String),
    Copyright(String),
    User(String),
    Annotator(String),

    Handicap(u8),
    Komi(f64),
    TerritoryBlack(Vec<Point>),
    TerritoryWhite(Vec<Point>),

    // -- Annotation properties --
    Comment(String),
    NodeName(String),
    NodeValue(f64),
    EvenPosition(Double),
    GoodForBlack(Double),
    GoodForWhite(Double),
    UnclearPosition(Double),
    Hotspot(Double),

    BadMove(Double),
    Tesuji(Double),
    DoubtfulMove,
    InterestingMove,

    Arrows(Vec<PointPair>),
    Circles(Vec<Point>),
    XMarks(Vec<Point>),
    Triangles(Vec<Point>),
    Squares(Vec<Point>),
    SelectedPoints(Vec<Point>),
    Labels(Vec<Label>),
    Lines(Vec<PointPair>),
    DimPoints(Vec<Point>),

    BlackTime(f64),
    WhiteTime(f64),
    BlackOvertimePeriods(u32),
    WhiteOvertimePeriods(u32),

    Figure(Option<(u32, String)>),
    PrintMoveMode(u32),
    View(Vec<Point>),

    Unknown(String, Vec<String>),
}
