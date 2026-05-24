use std::time::Duration;

use reqwest::Client;
use serde::Serialize;
use tracing::warn;

pub struct HttpClient {
    http: Client,
    base_url: String,
    api_token: String,
}

impl HttpClient {
    pub fn new(base_url: &str, api_token: &str) -> Self {
        let http = Client::builder()
            .user_agent("seki-client/0.1.0")
            .build()
            .expect("Failed to create HTTP client");
        HttpClient {
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_token: api_token.to_string(),
        }
    }

    pub async fn get<T: for<'de> serde::de::DeserializeOwned>(
        &self,
        path: &str,
    ) -> Result<T, String> {
        let url = format!("{}{}", self.base_url, path);
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
            return Err(format!("GET {} returned {status}: {body}", path));
        }

        resp.json::<T>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))
    }

    pub async fn get_with_retry<T: for<'de> serde::de::DeserializeOwned>(&self, path: &str) -> T {
        let mut delay = Duration::from_secs(1);
        loop {
            match self.get::<T>(path).await {
                Ok(val) => return val,
                Err(e) => {
                    warn!("[http] GET {path} failed, retrying in {delay:?}: {e}");
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_secs(30));
                }
            }
        }
    }

    pub async fn post<T: for<'de> serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T, String> {
        let url = format!("{}{}", self.base_url, path);
        let resp = self
            .http
            .post(&url)
            .bearer_auth(&self.api_token)
            .json(body)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("POST {} returned {status}: {body}", path));
        }

        resp.json::<T>()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))
    }
}
