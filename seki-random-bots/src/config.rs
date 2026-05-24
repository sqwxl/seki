use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    #[serde(default = "default_server_url")]
    pub server_url: String,
    pub bot_count: u32,
    #[serde(default)]
    pub timing: Timing,
    #[serde(default)]
    pub probabilities: Probabilities,
    #[serde(default)]
    pub game_settings: GameSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Timing {
    #[serde(default = "default_action_interval_ms")]
    pub action_interval_ms: u64,
    #[serde(default = "default_jitter_ms")]
    pub jitter_ms: u64,
}

impl Default for Timing {
    fn default() -> Self {
        Timing {
            action_interval_ms: default_action_interval_ms(),
            jitter_ms: default_jitter_ms(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Probabilities {
    #[allow(dead_code)]
    #[serde(default = "default_prob_10")]
    pub create_open_game: f64,
    #[allow(dead_code)]
    #[serde(default = "default_prob_05")]
    pub challenge_player: f64,
    #[allow(dead_code)]
    #[serde(default = "default_prob_40")]
    pub join_open_game: f64,
    #[serde(default = "default_prob_50")]
    pub play_move: f64,
    #[serde(default = "default_prob_10")]
    pub pass_turn: f64,
    #[serde(default = "default_prob_02")]
    pub resign: f64,
    #[serde(default = "default_prob_03")]
    pub request_undo: f64,
    #[serde(default = "default_prob_05")]
    pub chat: f64,
}

impl Default for Probabilities {
    fn default() -> Self {
        Probabilities {
            create_open_game: default_prob_10(),
            challenge_player: default_prob_05(),
            join_open_game: default_prob_40(),
            play_move: default_prob_50(),
            pass_turn: default_prob_10(),
            resign: default_prob_02(),
            request_undo: default_prob_03(),
            chat: default_prob_05(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct GameSettings {
    #[serde(default = "default_board_sizes")]
    pub board_sizes: Vec<[i32; 2]>,
    #[serde(default = "default_time_controls")]
    pub time_controls: Vec<String>,
    #[serde(default = "default_main_time_max")]
    pub main_time_secs_max: i32,
    #[serde(default = "default_main_time_min")]
    pub main_time_secs_min: i32,
    #[serde(default = "default_byoyomi_time_max")]
    pub byoyomi_time_secs_max: i32,
    #[serde(default = "default_byoyomi_time_min")]
    pub byoyomi_time_secs_min: i32,
    #[serde(default = "default_byoyomi_periods_max")]
    pub byoyomi_periods_max: i32,
    #[serde(default = "default_byoyomi_periods_min")]
    pub byoyomi_periods_min: i32,
    #[serde(default = "default_private_probability")]
    pub private_probability: f64,
    #[serde(default = "default_ranked_probability")]
    pub ranked_probability: f64,
}

impl Default for GameSettings {
    fn default() -> Self {
        GameSettings {
            board_sizes: default_board_sizes(),
            time_controls: default_time_controls(),
            main_time_secs_max: default_main_time_max(),
            main_time_secs_min: default_main_time_min(),
            byoyomi_time_secs_max: default_byoyomi_time_max(),
            byoyomi_time_secs_min: default_byoyomi_time_min(),
            byoyomi_periods_max: default_byoyomi_periods_max(),
            byoyomi_periods_min: default_byoyomi_periods_min(),
            private_probability: default_private_probability(),
            ranked_probability: default_ranked_probability(),
        }
    }
}

fn default_server_url() -> String {
    "http://localhost:3000".to_string()
}

fn default_action_interval_ms() -> u64 {
    500
}

fn default_jitter_ms() -> u64 {
    500
}

fn default_prob_10() -> f64 {
    0.10
}
fn default_prob_40() -> f64 {
    0.40
}
fn default_prob_50() -> f64 {
    0.50
}
fn default_prob_02() -> f64 {
    0.02
}
fn default_prob_03() -> f64 {
    0.03
}
fn default_prob_05() -> f64 {
    0.05
}

fn default_board_sizes() -> Vec<[i32; 2]> {
    vec![[9, 9], [13, 13], [19, 19]]
}

fn default_time_controls() -> Vec<String> {
    vec!["none".into(), "fischer".into(), "byoyomi".into()]
}

fn default_main_time_max() -> i32 {
    1800
}
fn default_main_time_min() -> i32 {
    300
}
fn default_byoyomi_time_max() -> i32 {
    60
}
fn default_byoyomi_time_min() -> i32 {
    10
}
fn default_byoyomi_periods_max() -> i32 {
    5
}
fn default_byoyomi_periods_min() -> i32 {
    1
}
fn default_private_probability() -> f64 {
    0.2
}
fn default_ranked_probability() -> f64 {
    0.3
}

impl Config {
    pub fn load(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&content)?)
    }
}

impl Default for Config {
    fn default() -> Self {
        Config {
            server_url: default_server_url(),
            bot_count: 1,
            timing: Timing::default(),
            probabilities: Probabilities::default(),
            game_settings: GameSettings::default(),
        }
    }
}
