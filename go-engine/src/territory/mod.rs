mod alive;
mod dead_stones;
mod scoring;

pub use alive::find_unconditionally_alive;
pub use dead_stones::detect_dead_stones;
pub use scoring::{
    GameScore, PlayerPoints, estimate_territory, format_result, score, toggle_dead_chain,
};
