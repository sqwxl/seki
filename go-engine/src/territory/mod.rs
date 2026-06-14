mod alive;
mod dead_stones;
mod pass_alive;
mod scoring;

pub use dead_stones::detect_dead_stones;
pub use pass_alive::{
    AreaOptions, IndependentLifeArea, calculate_area, calculate_independent_life_area,
};
pub use scoring::{
    GameScore, PlayerPoints, estimate_territory, format_result, score, toggle_dead_chain,
};
