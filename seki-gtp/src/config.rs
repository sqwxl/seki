use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    #[serde(default = "default_server_url")]
    pub server_url: String,
    #[serde(default)]
    pub api_token: String,
    #[serde(default = "default_max_concurrent_games")]
    pub max_concurrent_games: usize,
    #[serde(default)]
    pub engine: Option<EngineConfig>,
    #[serde(default)]
    pub time: TimeConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EngineConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TimeConfig {
    #[serde(default = "default_engine_timeout_ms")]
    pub engine_timeout_ms: u64,
}

impl Default for TimeConfig {
    fn default() -> Self {
        TimeConfig {
            engine_timeout_ms: default_engine_timeout_ms(),
        }
    }
}

fn default_server_url() -> String {
    "http://localhost:3333".to_string()
}

fn default_max_concurrent_games() -> usize {
    4
}

fn default_engine_timeout_ms() -> u64 {
    60_000
}

impl Config {
    pub fn load(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&content)?)
    }
}
