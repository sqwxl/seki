mod action;
mod bot;
mod config;

use std::path::PathBuf;

use clap::Parser;
use tracing_subscriber::EnvFilter;

#[derive(clap::Parser, Debug)]
#[command(
    name = "seki-random-bots",
    about = "Simulate random user activity on a seki server"
)]
struct Cli {
    #[arg(short, long, help = "Path to config file (TOML)")]
    config: Option<PathBuf>,

    #[arg(long, help = "Server URL (overrides config)")]
    server: Option<String>,

    #[arg(long, help = "Number of bots (overrides config)")]
    bot_count: Option<u32>,

    #[arg(short, long, help = "Enable verbose logging")]
    verbose: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    let filter = if cli.verbose {
        EnvFilter::new("seki_random_bots=debug,seki_client=debug,tokio_tungstenite=warn")
    } else {
        EnvFilter::new("seki_random_bots=info,seki_client=warn,tokio_tungstenite=warn")
    };

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .without_time()
        .init();

    let mut config = if let Some(path) = &cli.config {
        let path_str: &str = path.to_str().unwrap_or("random-bots.toml");
        config::Config::load(path_str)?
    } else {
        config::Config::default()
    };

    if let Some(server) = cli.server {
        config.server_url = server;
    }
    if let Some(count) = cli.bot_count {
        config.bot_count = count;
    }

    config.bot_count = config.bot_count.max(1);

    tracing::info!(
        "Starting {} random bots against {}",
        config.bot_count,
        config.server_url
    );

    let mut handles = Vec::new();
    for i in 0..config.bot_count {
        let cfg = config.clone();
        handles.push(tokio::spawn(async move {
            if let Err(e) = bot::BotRunner::run(cfg, i).await {
                tracing::error!("bot-{i} exited with error: {e}");
            }
        }));
    }

    for handle in handles {
        let _ = handle.await;
    }

    Ok(())
}
