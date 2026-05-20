use crate::config::Config;

#[derive(serde::Deserialize)]
struct MeResponse {
    id: i64,
    username: String,
    is_registered: bool,
}

pub struct MeData {
    pub id: i64,
    pub username: String,
}

pub struct Client {
    http: reqwest::Client,
    base_url: String,
    api_token: String,
}

impl Client {
    pub fn new(config: &Config) -> Self {
        let http = reqwest::Client::builder()
            .user_agent("seki-gtp/0.1.0")
            .build()
            .expect("Failed to create HTTP client");
        Client {
            http,
            base_url: config.server_url.trim_end_matches('/').to_string(),
            api_token: config.api_token.clone(),
        }
    }

    pub async fn get_me(&self) -> Result<MeData, String> {
        let url = format!("{}/api/me", self.base_url);
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&self.api_token)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("GET /api/me returned {status}: {body}"));
        }

        let me = resp
            .json::<MeResponse>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;

        if !me.is_registered {
            return Err("API token belongs to an anonymous/unregistered user".to_string());
        }

        Ok(MeData {
            id: me.id,
            username: me.username,
        })
    }
}
