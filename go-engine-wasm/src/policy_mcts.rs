use go_engine::goban::Captures;
use go_engine::mcts::{
    self, BotMove, ExternalEvaluation, ExternalMctsConfig, ExternalMctsSearch, MctsConfig,
};
use go_engine::{Engine, GameState, Ko, Stone, Turn};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyMctsRequest {
    visits: Option<u32>,
    cpuct: Option<f32>,
    fpu_reduction: Option<f32>,
    max_policy_actions: Option<usize>,
    komi: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyMctsEvaluations {
    evaluations: Vec<PolicyMctsEvaluation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyMctsEvaluation {
    id: u32,
    policy_logits: Vec<f32>,
    value: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyMctsBatchResponse {
    error: Option<String>,
    requests: Vec<PolicyMctsEvalRequest>,
    completed_visits: u32,
    pending: usize,
    complete: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyMctsStatusResponse {
    error: Option<String>,
    completed_visits: u32,
    pending: usize,
    complete: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyMctsSummaryResponse {
    error: Option<String>,
    best_move: Option<WasmBotMove>,
    visits: u32,
    winrate: f32,
    root_value: f32,
    root_edges: Vec<WasmMctsEdge>,
    principal_variation: Vec<WasmBotMove>,
    diagnostics: WasmMctsDiagnostics,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyMctsEvalRequest {
    id: u32,
    position: AiPocPosition,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiPocPosition {
    board_size: u8,
    next_player: String,
    komi: f64,
    stones: Vec<AiPocStone>,
    recent_moves: Vec<AiPocMove>,
    ko: Option<AiPocKo>,
    rules: AiPocRules,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiPocStone {
    col: u8,
    row: u8,
    player: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum AiPocMove {
    Play { col: u8, row: u8, player: String },
    Pass { player: String },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiPocKo {
    col: u8,
    row: u8,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiPocRules {
    ko_rule: String,
    scoring: String,
    tax: String,
    multi_stone_suicide_legal: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmMctsEdge {
    action: WasmBotMove,
    #[serde(rename = "move")]
    move_label: String,
    visits: u32,
    prior: f32,
    value: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmMctsDiagnostics {
    catch_up_visits: u32,
    cycle_visits: u32,
    terminal_visits: u32,
    invalid_action_visits: u32,
    root_visit_entropy: f32,
    visited_root_moves: usize,
    visited_root_policy_mass: f32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyRankRequest {
    position: AiPocPosition,
    policy_logits: Vec<f32>,
    max_policy_actions: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyRankResponse {
    error: Option<String>,
    moves: Vec<WasmMctsEdge>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WasmBotMove {
    Play { col: u8, row: u8 },
    Pass,
}

#[wasm_bindgen]
pub struct WasmPolicyMcts {
    search: Option<ExternalMctsSearch>,
    error: Option<String>,
    komi: f64,
    board_rows: u8,
}

#[wasm_bindgen]
impl WasmPolicyMcts {
    pub fn next_batch_json(&mut self, batch_size: usize) -> String {
        let Some(search) = self.search.as_mut() else {
            return batch_json(self.error.clone(), Vec::new(), 0, 0, true);
        };
        let requests = search
            .next_evaluations(batch_size)
            .into_iter()
            .map(|pending| PolicyMctsEvalRequest {
                id: pending.id,
                position: position_from_engine(&pending.engine, self.komi),
            })
            .collect();

        batch_json(
            None,
            requests,
            search.completed_visits(),
            search.pending_count(),
            search.is_complete(),
        )
    }

    pub fn apply_batch_json(&mut self, evaluations_json: &str) -> String {
        let Some(search) = self.search.as_mut() else {
            return status_json(self.error.clone(), 0, 0, true);
        };
        let evaluations = match serde_json::from_str::<PolicyMctsEvaluations>(evaluations_json) {
            Ok(request) => request
                .evaluations
                .into_iter()
                .map(|evaluation| ExternalEvaluation {
                    id: evaluation.id,
                    policy_logits: evaluation.policy_logits,
                    value: evaluation.value,
                })
                .collect(),
            Err(err) => {
                return status_json(
                    Some(format!("invalid policy MCTS evals: {err}")),
                    search.completed_visits(),
                    search.pending_count(),
                    search.is_complete(),
                );
            }
        };

        search.apply_evaluations(evaluations);
        status_json(
            None,
            search.completed_visits(),
            search.pending_count(),
            search.is_complete(),
        )
    }

    pub fn summary_json(&self) -> String {
        let Some(search) = self.search.as_ref() else {
            return serde_json::to_string(&PolicyMctsSummaryResponse {
                error: self.error.clone(),
                best_move: None,
                visits: 0,
                winrate: 0.5,
                root_value: 0.0,
                root_edges: Vec::new(),
                principal_variation: Vec::new(),
                diagnostics: WasmMctsDiagnostics {
                    catch_up_visits: 0,
                    cycle_visits: 0,
                    terminal_visits: 0,
                    invalid_action_visits: 0,
                    root_visit_entropy: 0.0,
                    visited_root_moves: 0,
                    visited_root_policy_mass: 0.0,
                },
            })
            .unwrap_or_else(|err| error_json(&err.to_string()));
        };
        let summary = search.summary();

        serde_json::to_string(&PolicyMctsSummaryResponse {
            error: None,
            best_move: summary.best_move.map(WasmBotMove::from),
            visits: summary.visits,
            winrate: ((summary.root_value + 1.0) / 2.0).clamp(0.0, 1.0),
            root_value: summary.root_value,
            root_edges: summary
                .root_edges
                .iter()
                .map(|edge| WasmMctsEdge {
                    action: WasmBotMove::from(edge.action()),
                    move_label: format_bot_move(edge.action(), self.board_rows),
                    visits: edge.visits(),
                    prior: edge.prior(),
                    value: edge.mean_value(),
                })
                .collect(),
            principal_variation: summary
                .principal_variation
                .iter()
                .copied()
                .map(WasmBotMove::from)
                .collect(),
            diagnostics: WasmMctsDiagnostics {
                catch_up_visits: summary.diagnostics.catch_up_visits,
                cycle_visits: summary.diagnostics.cycle_visits,
                terminal_visits: summary.diagnostics.terminal_visits,
                invalid_action_visits: summary.diagnostics.invalid_action_visits,
                root_visit_entropy: summary.diagnostics.root_visit_entropy,
                visited_root_moves: summary.diagnostics.visited_root_moves,
                visited_root_policy_mass: summary.diagnostics.visited_root_policy_mass,
            },
        })
        .unwrap_or_else(|err| error_json(&err.to_string()))
    }
}

pub fn create(engine: &Engine, request_json: &str) -> WasmPolicyMcts {
    let request = match serde_json::from_str::<PolicyMctsRequest>(request_json) {
        Ok(request) => request,
        Err(err) => {
            return WasmPolicyMcts {
                search: None,
                error: Some(format!("invalid policy MCTS request: {err}")),
                komi: 6.5,
                board_rows: engine.rows(),
            };
        }
    };
    let visits = request.visits.unwrap_or(64).clamp(1, 10_000);
    let cpuct = request.cpuct.unwrap_or(1.5).clamp(0.01, 100.0);
    let fpu_reduction = request.fpu_reduction.unwrap_or(0.2).clamp(0.0, 2.0);
    let max_policy_actions = request
        .max_policy_actions
        .map(|limit| limit.clamp(1, 10_000));
    let komi = request.komi.unwrap_or(6.5);

    WasmPolicyMcts {
        search: Some(ExternalMctsSearch::new(
            engine.clone(),
            ExternalMctsConfig {
                search: MctsConfig {
                    visits,
                    cpuct,
                    fpu_reduction,
                },
                max_policy_actions,
            },
        )),
        error: None,
        komi,
        board_rows: engine.rows(),
    }
}

pub fn create_from_position_json(position_json: &str, request_json: &str) -> WasmPolicyMcts {
    let position = match serde_json::from_str::<AiPocPosition>(position_json) {
        Ok(position) => position,
        Err(err) => {
            return WasmPolicyMcts {
                search: None,
                error: Some(format!("invalid policy MCTS position: {err}")),
                komi: 6.5,
                board_rows: 0,
            };
        }
    };
    let engine = match engine_from_position(&position) {
        Ok(engine) => engine,
        Err(err) => {
            return WasmPolicyMcts {
                search: None,
                error: Some(err),
                komi: position.komi,
                board_rows: position.board_size,
            };
        }
    };

    create(&engine, request_json)
}

pub fn rank_policy_json(request_json: &str) -> String {
    let request = match serde_json::from_str::<PolicyRankRequest>(request_json) {
        Ok(request) => request,
        Err(err) => return error_json(&format!("invalid policy rank request: {err}")),
    };
    let engine = match engine_from_position(&request.position) {
        Ok(engine) => engine,
        Err(err) => return error_json(&err),
    };
    let priors = mcts::policy_priors_from_logits(
        &engine,
        engine.current_turn_stone(),
        &request.policy_logits,
        request
            .max_policy_actions
            .map(|limit| limit.clamp(1, 10_000)),
    );
    let moves = priors
        .into_iter()
        .map(|prior| WasmMctsEdge {
            action: WasmBotMove::from(prior.action),
            move_label: format_bot_move(prior.action, engine.rows()),
            visits: 0,
            prior: prior.prior,
            value: 0.0,
        })
        .collect();

    serde_json::to_string(&PolicyRankResponse { error: None, moves })
        .unwrap_or_else(|err| error_json(&err.to_string()))
}

impl From<BotMove> for WasmBotMove {
    fn from(value: BotMove) -> Self {
        match value {
            BotMove::Play((col, row)) => Self::Play { col, row },
            BotMove::Pass => Self::Pass,
        }
    }
}

fn format_bot_move(action: BotMove, board_rows: u8) -> String {
    match action {
        BotMove::Play((col, row)) => format!("{}{}", gtp_column(col), board_rows - row),
        BotMove::Pass => "pass".to_string(),
    }
}

fn gtp_column(col: u8) -> char {
    char::from(b'A' + col + u8::from(col >= 8))
}

fn position_from_engine(engine: &Engine, komi: f64) -> AiPocPosition {
    AiPocPosition {
        board_size: engine.cols(),
        next_player: stone_name(engine.current_turn_stone()).to_string(),
        komi,
        stones: stones_from_engine(engine),
        recent_moves: recent_moves_from_engine(engine),
        ko: engine.ko().as_ref().map(|ko| AiPocKo {
            col: ko.pos.0 as u8,
            row: ko.pos.1 as u8,
        }),
        rules: AiPocRules {
            ko_rule: "positional".to_string(),
            scoring: "area".to_string(),
            tax: "none".to_string(),
            multi_stone_suicide_legal: false,
        },
    }
}

fn stones_from_engine(engine: &Engine) -> Vec<AiPocStone> {
    let mut stones = Vec::new();

    for row in 0..engine.rows() {
        for col in 0..engine.cols() {
            let Some(stone) = Stone::from_int(
                engine.board()[row as usize * engine.cols() as usize + col as usize],
            ) else {
                continue;
            };

            stones.push(AiPocStone {
                col,
                row,
                player: stone_name(stone).to_string(),
            });
        }
    }

    stones
}

fn recent_moves_from_engine(engine: &Engine) -> Vec<AiPocMove> {
    engine
        .moves()
        .iter()
        .rev()
        .filter_map(|turn| {
            if turn.is_play() {
                let (col, row) = turn.pos?;

                Some(AiPocMove::Play {
                    col,
                    row,
                    player: stone_name(turn.stone).to_string(),
                })
            } else if turn.is_pass() {
                Some(AiPocMove::Pass {
                    player: stone_name(turn.stone).to_string(),
                })
            } else {
                None
            }
        })
        .take(5)
        .collect()
}

fn stone_name(stone: Stone) -> &'static str {
    match stone {
        Stone::Black => "black",
        Stone::White => "white",
    }
}

fn engine_from_position(position: &AiPocPosition) -> Result<Engine, String> {
    let board_size = position.board_size;
    let board_area = board_size as usize * board_size as usize;
    let mut board = vec![0; board_area];

    for stone in &position.stones {
        if stone.col >= board_size || stone.row >= board_size {
            return Err("PoC position contains an off-board stone".to_string());
        }

        let index = stone.row as usize * board_size as usize + stone.col as usize;
        if board[index] != 0 {
            return Err("PoC position contains duplicate stones".to_string());
        }

        board[index] = stone_from_name(&stone.player)?.to_int();
    }

    let ko = position.ko.as_ref().map(|ko| Ko {
        pos: (ko.col as i8, ko.row as i8),
        illegal: stone_from_name(&position.next_player).unwrap_or(Stone::Black),
    });
    let moves = match stone_from_name(&position.next_player)? {
        Stone::Black => Vec::new(),
        Stone::White => vec![Turn::pass(Stone::Black)],
    };

    Ok(Engine::from_game_state(
        board_size,
        board_size,
        0,
        moves,
        GameState {
            board,
            cols: board_size,
            rows: board_size,
            captures: Captures::new(),
            ko,
            last_move: None,
        },
    ))
}

fn stone_from_name(name: &str) -> Result<Stone, String> {
    match name {
        "black" => Ok(Stone::Black),
        "white" => Ok(Stone::White),
        _ => Err(format!("unknown stone: {name}")),
    }
}

fn batch_json(
    error: Option<String>,
    requests: Vec<PolicyMctsEvalRequest>,
    completed_visits: u32,
    pending: usize,
    complete: bool,
) -> String {
    serde_json::to_string(&PolicyMctsBatchResponse {
        error,
        requests,
        completed_visits,
        pending,
        complete,
    })
    .unwrap_or_else(|err| error_json(&err.to_string()))
}

fn status_json(
    error: Option<String>,
    completed_visits: u32,
    pending: usize,
    complete: bool,
) -> String {
    serde_json::to_string(&PolicyMctsStatusResponse {
        error,
        completed_visits,
        pending,
        complete,
    })
    .unwrap_or_else(|err| error_json(&err.to_string()))
}

fn error_json(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn requests_root_position_for_first_batch() {
        let engine = Engine::new(3, 3);
        let mut search = create(&engine, r#"{"visits":2,"maxPolicyActions":2,"komi":0.5}"#);

        let json = search.next_batch_json(4);
        let response: Value = serde_json::from_str(&json).expect("valid batch json");

        assert_eq!(response["requests"].as_array().expect("requests").len(), 1);
        assert_eq!(response["requests"][0]["position"]["boardSize"], 3);
        assert_eq!(response["requests"][0]["position"]["nextPlayer"], "black");
        assert_eq!(response["requests"][0]["position"]["komi"], 0.5);
    }

    #[test]
    fn position_json_root_preserves_stones_without_move_history() {
        let position = r#"{
            "boardSize":3,
            "nextPlayer":"black",
            "komi":6.5,
            "stones":[{"col":1,"row":1,"player":"white"}],
            "recentMoves":[],
            "rules":{
                "koRule":"positional",
                "scoring":"area",
                "tax":"none",
                "multiStoneSuicideLegal":false
            }
        }"#;
        let mut search =
            create_from_position_json(position, r#"{"visits":2,"maxPolicyActions":2,"komi":6.5}"#);

        let json = search.next_batch_json(4);
        let response: Value = serde_json::from_str(&json).expect("valid batch json");

        assert_eq!(
            response["requests"][0]["position"]["stones"][0]["player"],
            "white"
        );
        assert_eq!(response["requests"][0]["position"]["stones"][0]["col"], 1);
        assert_eq!(response["requests"][0]["position"]["stones"][0]["row"], 1);
    }

    #[test]
    fn policy_rank_from_position_masks_occupied_points() {
        let json = rank_policy_json(
            r#"{
                "position":{
                    "boardSize":3,
                    "nextPlayer":"black",
                    "komi":6.5,
                    "stones":[{"col":1,"row":1,"player":"white"}],
                    "recentMoves":[],
                    "rules":{
                        "koRule":"positional",
                        "scoring":"area",
                        "tax":"none",
                        "multiStoneSuicideLegal":false
                    }
                },
                "policyLogits":[0,0,0,0,20,0,0,0,8,0],
                "maxPolicyActions":2
            }"#,
        );
        let response: Value = serde_json::from_str(&json).expect("valid rank json");

        assert!(response["error"].is_null());
        assert_eq!(response["moves"].as_array().expect("moves").len(), 2);
        assert_eq!(response["moves"][0]["move"], "C1");
        assert_ne!(response["moves"][0]["move"], "B2");
    }

    #[test]
    fn applies_eval_batch_and_returns_summary() {
        let engine = Engine::new(3, 3);
        let mut search = create(&engine, r#"{"visits":1,"maxPolicyActions":1,"komi":0.5}"#);
        let batch: Value =
            serde_json::from_str(&search.next_batch_json(1)).expect("valid batch json");
        let id = batch["requests"][0]["id"].as_u64().expect("request id");

        search.apply_batch_json(&format!(
            r#"{{"evaluations":[{{"id":{id},"policyLogits":[0,0,0,0,0,0,0,0,8,0],"value":0.25}}]}}"#
        ));
        let summary: Value =
            serde_json::from_str(&search.summary_json()).expect("valid summary json");

        assert_eq!(summary["visits"], 1);
        assert_eq!(summary["rootValue"], 0.25);
        assert_eq!(summary["rootEdges"].as_array().expect("edges").len(), 1);
        assert_eq!(summary["rootEdges"][0]["action"]["col"], 2);
        assert_eq!(summary["rootEdges"][0]["action"]["row"], 2);
        assert_eq!(summary["rootEdges"][0]["move"], "C1");
        assert_eq!(
            summary["principalVariation"]
                .as_array()
                .expect("principal variation")
                .len(),
            0
        );
        assert_eq!(summary["diagnostics"]["catchUpVisits"], 0);
        assert_eq!(summary["diagnostics"]["cycleVisits"], 0);
        assert_eq!(summary["diagnostics"]["rootVisitEntropy"], 0.0);
        assert_eq!(summary["diagnostics"]["visitedRootMoves"], 0);
        assert_eq!(summary["diagnostics"]["visitedRootPolicyMass"], 0.0);
    }
}
