use std::path::PathBuf;

use clap::Parser;
use tracing_subscriber::EnvFilter;

use seki_gtp::bot::Bot;
use seki_gtp::client::Client;
use seki_gtp::config::Config;
use seki_gtp::engine::spawn_engine;

#[derive(Parser, Debug)]
#[command(name = "seki-gtp", about = "GTP bridge for the seki Go server")]
struct Cli {
    #[arg(short, long, help = "Path to config file (TOML)")]
    config: Option<PathBuf>,

    #[arg(long, help = "Server URL (overrides config)")]
    server: Option<String>,

    #[arg(long, help = "API token (overrides config)")]
    token: Option<String>,

    #[arg(long, help = "Max concurrent games (overrides config)")]
    max_games: Option<usize>,

    #[arg(short, long, help = "Enable verbose logging")]
    verbose: bool,

    /// Engine command and arguments (everything after --)
    #[arg(last = true, required = true)]
    engine: Vec<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    let filter = if cli.verbose {
        EnvFilter::new("seki_gtp=debug,tokio_tungstenite=warn")
    } else {
        EnvFilter::new("seki_gtp=info")
    };

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .without_time()
        .init();

    let mut config = if let Some(path) = &cli.config {
        Config::load(path.to_str().unwrap_or("config.toml"))?
    } else {
        Config {
            server_url: "http://localhost:3000".to_string(),
            api_token: String::new(),
            max_concurrent_games: 4,
            engine: None,
            time: seki_gtp::config::TimeConfig::default(),
        }
    };

    if let Some(server) = cli.server {
        config.server_url = server;
    }
    if let Some(token) = cli.token {
        config.api_token = token;
    }
    if let Some(max) = cli.max_games {
        config.max_concurrent_games = max;
    }

    let engine_cfg = if !cli.engine.is_empty() {
        seki_gtp::config::EngineConfig {
            command: cli.engine[0].clone(),
            args: cli.engine[1..].to_vec(),
        }
    } else {
        config.engine.clone().unwrap_or_else(|| {
            eprintln!("Error: Engine command is required. Pass it after --.");
            std::process::exit(1);
        })
    };

    if config.api_token.is_empty() {
        eprintln!("Error: API token is required. Set it in config or pass --token.");
        std::process::exit(1);
    }

    let client = Client::new(&config);
    let me = client
        .get_me()
        .await
        .map_err(|e| format!("Failed to authenticate: {e}"))?;
    tracing::info!("Authenticated as {} (id={})", me.username, me.id);

    let engine = spawn_engine(&engine_cfg.command, &engine_cfg.args).await?;

    Bot::run(config, engine, me.id)
        .await
        .map_err(|e| format!("Bot error: {e}"))?;

    Ok(())
}
