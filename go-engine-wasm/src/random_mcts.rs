use go_engine::Engine;
use go_engine::mcts::{
    self, BotMove, MctsConfig, RandomRolloutEvaluator, RolloutConfig, RootPolicyRolloutEvaluator,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RandomMctsRequest {
    visits: Option<u32>,
    rollout_limit: Option<u32>,
    seed: Option<u64>,
    komi: Option<f64>,
    cpuct: Option<f32>,
    max_policy_actions: Option<usize>,
    root_policy_logits: Option<Vec<f32>>,
    root_value: Option<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RandomMctsResponse {
    best_move: Option<WasmBotMove>,
    visits: u32,
    winrate: f32,
    root_value: f32,
    max_policy_actions: Option<usize>,
    policy_source: &'static str,
    value_source: &'static str,
    root_edges: Vec<WasmMctsEdge>,
    principal_variation: Vec<WasmBotMove>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmMctsEdge {
    action: WasmBotMove,
    visits: u32,
    prior: f32,
    value: f32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WasmBotMove {
    Play { col: u8, row: u8 },
    Pass,
}

pub fn run(engine: &Engine, request_json: &str) -> String {
    let request = match serde_json::from_str::<RandomMctsRequest>(request_json) {
        Ok(request) => request,
        Err(err) => return error_json(&format!("invalid random MCTS request: {err}")),
    };
    let default_rollout = RolloutConfig::default();
    let visits = request.visits.unwrap_or(64).clamp(1, 10_000);
    let rollout_limit = request
        .rollout_limit
        .unwrap_or(default_rollout.limit)
        .clamp(1, 10_000);
    let seed = request.seed.unwrap_or(default_rollout.seed);
    let komi = request.komi.unwrap_or(6.5);
    let cpuct = request.cpuct.unwrap_or(1.5).clamp(0.01, 100.0);
    let max_policy_actions = request
        .max_policy_actions
        .map(|limit| limit.clamp(1, 10_000))
        .or(default_rollout.max_policy_actions);
    let rollout_config = RolloutConfig {
        limit: rollout_limit,
        seed,
        max_policy_actions,
    };
    let search_config = MctsConfig { visits, cpuct };

    let (summary, policy_source, value_source) =
        if let Some(root_policy_logits) = request.root_policy_logits.as_deref() {
            if root_policy_logits.is_empty() {
                return error_json("rootPolicyLogits must not be empty");
            }

            let root_value = request.root_value.unwrap_or(0.0);
            let mut evaluator = RootPolicyRolloutEvaluator::new(
                engine,
                root_policy_logits,
                root_value,
                rollout_config,
                komi,
            );

            (
                mcts::search(engine, search_config, &mut evaluator),
                "external-root",
                "external-root-and-rollout",
            )
        } else {
            let mut evaluator = RandomRolloutEvaluator::new(rollout_config, komi);

            (
                mcts::search(engine, search_config, &mut evaluator),
                "baseline-rollout",
                "rollout",
            )
        };
    let best_move = summary.best_move.map(WasmBotMove::from);
    let response = RandomMctsResponse {
        best_move,
        visits: summary.visits,
        winrate: ((summary.root_value + 1.0) / 2.0).clamp(0.0, 1.0),
        root_value: summary.root_value,
        max_policy_actions,
        policy_source,
        value_source,
        root_edges: summary
            .root_edges
            .iter()
            .map(|edge| WasmMctsEdge {
                action: WasmBotMove::from(edge.action()),
                visits: edge.visits(),
                prior: edge.prior(),
                value: edge.mean_value(),
            })
            .collect(),
        principal_variation: best_move.into_iter().collect(),
    };

    serde_json::to_string(&response).unwrap_or_else(|err| error_json(&err.to_string()))
}

impl From<BotMove> for WasmBotMove {
    fn from(value: BotMove) -> Self {
        match value {
            BotMove::Play((col, row)) => Self::Play { col, row },
            BotMove::Pass => Self::Pass,
        }
    }
}

fn error_json(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use go_engine::Stone;
    use serde_json::Value;

    #[test]
    fn returns_move_stats_without_mutating_board() {
        let engine = Engine::new(3, 3);
        let before = engine.board().to_vec();

        let json = run(
            &engine,
            r#"{"visits":8,"rolloutLimit":4,"seed":99,"komi":0.5,"cpuct":1.5}"#,
        );
        let response: Value = serde_json::from_str(&json).expect("valid response json");

        assert_eq!(response["visits"], 8);
        assert!(response["bestMove"]["kind"].is_string());
        assert_eq!(
            response["rootEdges"].as_array().expect("root edges").len(),
            10
        );
        assert_eq!(engine.board(), before.as_slice());
    }

    #[test]
    fn deterministic_for_same_seed() {
        let engine = Engine::new(3, 3);
        let request = r#"{"visits":8,"rolloutLimit":4,"seed":123,"komi":0.5}"#;

        assert_eq!(run(&engine, request), run(&engine, request));
    }

    #[test]
    fn caps_root_policy_actions() {
        let engine = Engine::new(19, 19);

        let json = run(
            &engine,
            r#"{"visits":8,"rolloutLimit":4,"seed":99,"maxPolicyActions":32}"#,
        );
        let response: Value = serde_json::from_str(&json).expect("valid response json");

        assert_eq!(response["maxPolicyActions"], 32);
        assert_eq!(
            response["rootEdges"].as_array().expect("root edges").len(),
            32
        );
    }

    #[test]
    fn root_policy_logits_drive_root_priors() {
        let engine = Engine::new(3, 3);
        let json = run(
            &engine,
            r#"{"visits":8,"rolloutLimit":4,"seed":99,"maxPolicyActions":1,"rootPolicyLogits":[0,0,0,0,0,0,0,0,8,0],"rootValue":0.25}"#,
        );
        let response: Value = serde_json::from_str(&json).expect("valid response json");
        let root_edges = response["rootEdges"].as_array().expect("root edges");

        assert_eq!(response["policySource"], "external-root");
        assert_eq!(response["valueSource"], "external-root-and-rollout");
        assert_eq!(root_edges.len(), 1);
        assert_eq!(root_edges[0]["action"]["col"], 2);
        assert_eq!(root_edges[0]["action"]["row"], 2);
        assert_eq!(root_edges[0]["prior"], 1.0);
    }

    #[test]
    fn rejects_empty_root_policy_logits() {
        let engine = Engine::new(3, 3);
        let json = run(&engine, r#"{"rootPolicyLogits":[]}"#);
        let response: Value = serde_json::from_str(&json).expect("valid error json");

        assert_eq!(response["error"], "rootPolicyLogits must not be empty");
    }

    #[test]
    fn handles_terminal_position() {
        let mut engine = Engine::new(3, 3);
        engine.try_pass(Stone::Black).expect("black pass");
        engine.try_pass(Stone::White).expect("white pass");

        let json = run(&engine, r#"{"visits":4,"rolloutLimit":2}"#);
        let response: Value = serde_json::from_str(&json).expect("valid response json");

        assert_eq!(response["visits"], 4);
        assert!(response["bestMove"].is_null());
        assert_eq!(
            response["rootEdges"].as_array().expect("root edges").len(),
            0
        );
    }

    #[test]
    fn reports_bad_requests() {
        let engine = Engine::new(3, 3);
        let json = run(&engine, "{");
        let response: Value = serde_json::from_str(&json).expect("valid error json");

        assert!(
            response["error"]
                .as_str()
                .expect("error string")
                .contains("invalid random MCTS request")
        );
    }
}
