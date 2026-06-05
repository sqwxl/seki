use std::collections::{HashMap, HashSet};

use crate::territory::{estimate_territory, score};
use crate::{Engine, GoError, Point, Stage, Stone};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BotMove {
    Play(Point),
    Pass,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActionPrior {
    pub action: BotMove,
    pub prior: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Evaluation {
    pub value: f32,
    pub priors: Vec<ActionPrior>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PositionKey {
    board: Box<[i8]>,
    to_play: Stone,
    ko: Option<((i8, i8), Stone)>,
    pass_streak: u8,
}

impl PositionKey {
    pub fn from_engine(engine: &Engine) -> Self {
        Self {
            board: engine.board().to_vec().into_boxed_slice(),
            to_play: engine.current_turn_stone(),
            ko: engine.ko().as_ref().map(|ko| (ko.pos, ko.illegal)),
            pass_streak: pass_streak(engine),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId(pub usize);

#[derive(Debug, Clone, PartialEq)]
pub struct EdgeStats {
    // KataGo GraphSearch.md: graph MCTS must keep parent-action stats separate
    // from shared child-node stats, because multiple parents can reach a node.
    action: BotMove,
    child: NodeId,
    prior: f32,
    visits: u32,
    value: f32,
}

impl EdgeStats {
    pub fn new(action: BotMove, child: NodeId, prior: f32) -> Self {
        Self {
            action,
            child,
            prior,
            visits: 0,
            value: 0.0,
        }
    }

    pub fn action(&self) -> BotMove {
        self.action
    }

    pub fn child(&self) -> NodeId {
        self.child
    }

    pub fn prior(&self) -> f32 {
        self.prior
    }

    pub fn visits(&self) -> u32 {
        self.visits
    }

    pub fn mean_value(&self) -> f32 {
        self.value
    }

    pub fn backup(&mut self, value: f32) {
        self.visits += 1;
        self.value = value;
    }

    fn increment_visit(&mut self) {
        self.visits += 1;
    }

    fn set_value(&mut self, value: f32) {
        self.value = value;
    }
}

#[derive(Debug, Clone)]
pub struct GraphNode {
    key: PositionKey,
    visits: u32,
    raw_value: Option<f32>,
    value: f32,
    edges: Vec<EdgeStats>,
}

impl GraphNode {
    pub fn new(key: PositionKey) -> Self {
        Self {
            key,
            visits: 0,
            raw_value: None,
            value: 0.0,
            edges: Vec::new(),
        }
    }

    pub fn key(&self) -> &PositionKey {
        &self.key
    }

    pub fn visits(&self) -> u32 {
        self.visits
    }

    pub fn edges(&self) -> &[EdgeStats] {
        &self.edges
    }

    pub fn push_edge(&mut self, edge: EdgeStats) {
        self.edges.push(edge);
    }

    pub fn mean_value(&self) -> f32 {
        self.value
    }

    pub fn backup_node(&mut self, value: f32) {
        self.raw_value = Some(value);
        self.visits += 1;
        self.value = value;
    }

    fn is_evaluated(&self) -> bool {
        self.raw_value.is_some()
    }

    fn set_raw_value(&mut self, value: f32) {
        self.raw_value = Some(value);
    }
}

pub trait MctsEvaluator {
    fn evaluate(&mut self, engine: &Engine, to_play: Stone) -> Evaluation;
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MctsConfig {
    pub visits: u32,
    pub cpuct: f32,
}

impl Default for MctsConfig {
    fn default() -> Self {
        Self {
            visits: 64,
            cpuct: 1.5,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SearchSummary {
    pub best_move: Option<BotMove>,
    pub visits: u32,
    pub root_value: f32,
    pub root_edges: Vec<EdgeStats>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExternalMctsConfig {
    pub search: MctsConfig,
    pub max_policy_actions: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct PendingEvaluation {
    pub id: u32,
    pub engine: Engine,
}

#[derive(Debug, Clone)]
pub struct ExternalEvaluation {
    pub id: u32,
    pub policy_logits: Vec<f32>,
    pub value: f32,
}

#[derive(Debug, Clone)]
struct PendingPath {
    node_id: NodeId,
    path: Vec<(NodeId, usize)>,
    engine: Engine,
}

fn recompute_node(nodes: &mut [GraphNode], node_id: NodeId) {
    let edge_values: Vec<(usize, f32)> = nodes[node_id.0]
        .edges
        .iter()
        .enumerate()
        .map(|(index, edge)| (index, -nodes[edge.child.0].mean_value()))
        .collect();
    let raw_value = nodes[node_id.0].raw_value;
    let mut visits = u32::from(raw_value.is_some());
    let mut value_sum = raw_value.unwrap_or(0.0);

    {
        let node = &mut nodes[node_id.0];
        for (edge_index, value) in edge_values {
            let edge = &mut node.edges[edge_index];
            edge.set_value(value);
            visits += edge.visits;
            value_sum += edge.visits as f32 * value;
        }

        node.visits = visits;
        node.value = if visits == 0 {
            0.0
        } else {
            value_sum / visits as f32
        };
    }
}

#[derive(Debug)]
struct GraphSearch<'a, E> {
    config: MctsConfig,
    evaluator: &'a mut E,
    nodes: Vec<GraphNode>,
    node_by_key: HashMap<PositionKey, NodeId>,
}

impl<'a, E: MctsEvaluator> GraphSearch<'a, E> {
    fn new(config: MctsConfig, evaluator: &'a mut E) -> Self {
        Self {
            config,
            evaluator,
            nodes: Vec::new(),
            node_by_key: HashMap::new(),
        }
    }

    fn search(&mut self, root: &Engine) -> SearchSummary {
        let root_id = self.intern_node(root);

        for _ in 0..self.config.visits {
            self.visit(root_id, root.clone());
        }

        let root_node = &self.nodes[root_id.0];
        let mut root_edges = root_node.edges.clone();
        root_edges.sort_by(|a, b| {
            b.visits
                .cmp(&a.visits)
                .then_with(|| b.prior.total_cmp(&a.prior))
        });

        SearchSummary {
            best_move: root_edges.first().map(EdgeStats::action),
            visits: root_node.visits,
            root_value: root_node.mean_value(),
            root_edges,
        }
    }

    fn visit(&mut self, root_id: NodeId, root: Engine) {
        let mut node_id = root_id;
        let mut engine = root;
        let mut path: Vec<(NodeId, usize)> = Vec::new();
        let mut active_nodes = HashSet::from([root_id]);

        loop {
            if !self.nodes[node_id.0].is_evaluated() {
                let to_play = engine.current_turn_stone();
                let evaluation = self.evaluator.evaluate(&engine, to_play);
                self.nodes[node_id.0].set_raw_value(evaluation.value);
                self.expand_node(node_id, &engine, evaluation.priors);
                recompute_node(&mut self.nodes, node_id);
                self.backup_path(&path);
                return;
            }

            if self.nodes[node_id.0].edges.is_empty() {
                self.backup_path(&path);
                return;
            }

            let Some(edge_index) = self.select_edge(node_id, &active_nodes) else {
                let edge_index = self.select_edge_allowing_cycle(node_id);
                path.push((node_id, edge_index));
                self.backup_cycle(&path);
                return;
            };

            let action = self.nodes[node_id.0].edges[edge_index].action;
            let child = self.nodes[node_id.0].edges[edge_index].child;

            if apply_action(&mut engine, action).is_err() {
                self.nodes[node_id.0].set_raw_value(-1.0);
                recompute_node(&mut self.nodes, node_id);
                self.backup_path(&path);
                return;
            }

            path.push((node_id, edge_index));
            node_id = child;
            if !active_nodes.insert(node_id) {
                self.backup_cycle(&path);
                return;
            }
        }
    }

    fn expand_node(&mut self, node_id: NodeId, engine: &Engine, priors: Vec<ActionPrior>) {
        let mut edges = Vec::with_capacity(priors.len());

        for prior in priors {
            let mut child_engine = engine.clone();
            if apply_action(&mut child_engine, prior.action).is_err() {
                continue;
            }
            let child = self.intern_node(&child_engine);
            edges.push(EdgeStats::new(prior.action, child, prior.prior.max(0.0)));
        }

        self.nodes[node_id.0].edges = edges;
    }

    fn select_edge(&self, node_id: NodeId, active_nodes: &HashSet<NodeId>) -> Option<usize> {
        self.best_edge(node_id, |edge| !active_nodes.contains(&edge.child))
    }

    fn select_edge_allowing_cycle(&self, node_id: NodeId) -> usize {
        self.best_edge(node_id, |_| true)
            .expect("expanded graph node has at least one edge")
    }

    fn best_edge(
        &self,
        node_id: NodeId,
        mut include: impl FnMut(&EdgeStats) -> bool,
    ) -> Option<usize> {
        let node = &self.nodes[node_id.0];
        let parent_visits = node.visits.max(1) as f32;
        let mut best_index = None;
        let mut best_score = f32::NEG_INFINITY;

        for (index, edge) in node.edges.iter().enumerate() {
            if !include(edge) {
                continue;
            }

            let q = edge.mean_value();
            let u =
                self.config.cpuct * edge.prior * parent_visits.sqrt() / (1 + edge.visits) as f32;
            let score = q + u;

            if score > best_score {
                best_index = Some(index);
                best_score = score;
            }
        }

        best_index
    }

    fn backup_path(&mut self, path: &[(NodeId, usize)]) {
        for &(node_id, edge_index) in path.iter().rev() {
            self.nodes[node_id.0].edges[edge_index].increment_visit();
            recompute_node(&mut self.nodes, node_id);
        }
    }

    fn backup_cycle(&mut self, path: &[(NodeId, usize)]) {
        for &(node_id, edge_index) in path.iter().rev() {
            self.nodes[node_id.0].edges[edge_index].increment_visit();
            recompute_node(&mut self.nodes, node_id);
        }
    }

    fn intern_node(&mut self, engine: &Engine) -> NodeId {
        let key = PositionKey::from_engine(engine);
        if let Some(id) = self.node_by_key.get(&key) {
            return *id;
        }

        let id = NodeId(self.nodes.len());
        self.nodes.push(GraphNode::new(key.clone()));
        self.node_by_key.insert(key, id);
        id
    }
}

#[derive(Debug)]
pub struct ExternalMctsSearch {
    config: ExternalMctsConfig,
    root: Engine,
    root_id: NodeId,
    nodes: Vec<GraphNode>,
    node_by_key: HashMap<PositionKey, NodeId>,
    pending: HashMap<u32, PendingPath>,
    pending_nodes: HashSet<NodeId>,
    next_eval_id: u32,
    completed_visits: u32,
}

impl ExternalMctsSearch {
    pub fn new(root: Engine, config: ExternalMctsConfig) -> Self {
        let root_key = PositionKey::from_engine(&root);
        let root_id = NodeId(0);
        let mut node_by_key = HashMap::new();

        node_by_key.insert(root_key.clone(), root_id);

        Self {
            config,
            root,
            root_id,
            nodes: vec![GraphNode::new(root_key)],
            node_by_key,
            pending: HashMap::new(),
            pending_nodes: HashSet::new(),
            next_eval_id: 1,
            completed_visits: 0,
        }
    }

    pub fn completed_visits(&self) -> u32 {
        self.completed_visits
    }

    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }

    pub fn is_complete(&self) -> bool {
        self.completed_visits >= self.config.search.visits && self.pending.is_empty()
    }

    pub fn next_evaluations(&mut self, max_batch_size: usize) -> Vec<PendingEvaluation> {
        let batch_size = max_batch_size.max(1);
        let mut evaluations = Vec::with_capacity(batch_size);

        while evaluations.len() < batch_size
            && self.completed_visits + (self.pending.len() as u32) < self.config.search.visits
        {
            let Some(evaluation) = self.prepare_evaluation() else {
                break;
            };
            evaluations.push(evaluation);
        }

        evaluations
    }

    pub fn apply_evaluations(&mut self, evaluations: Vec<ExternalEvaluation>) {
        for evaluation in evaluations {
            let Some(pending) = self.pending.remove(&evaluation.id) else {
                continue;
            };

            self.pending_nodes.remove(&pending.node_id);
            let to_play = pending.engine.current_turn_stone();
            let priors = policy_priors_from_logits(
                &pending.engine,
                to_play,
                &evaluation.policy_logits,
                self.config.max_policy_actions,
            );
            let value = if evaluation.value.is_finite() {
                evaluation.value.clamp(-1.0, 1.0)
            } else {
                0.0
            };

            self.nodes[pending.node_id.0].set_raw_value(value);
            self.expand_node(pending.node_id, &pending.engine, priors);
            recompute_node(&mut self.nodes, pending.node_id);
            self.backup_path(&pending.path);
            self.completed_visits += 1;
        }
    }

    pub fn summary(&self) -> SearchSummary {
        let root_node = &self.nodes[self.root_id.0];
        let mut root_edges = root_node.edges.clone();
        root_edges.sort_by(|a, b| {
            b.visits
                .cmp(&a.visits)
                .then_with(|| b.prior.total_cmp(&a.prior))
        });

        SearchSummary {
            best_move: root_edges.first().map(EdgeStats::action),
            visits: root_node.visits,
            root_value: root_node.mean_value(),
            root_edges,
        }
    }

    fn prepare_evaluation(&mut self) -> Option<PendingEvaluation> {
        loop {
            let mut node_id = self.root_id;
            let mut engine = self.root.clone();
            let mut path: Vec<(NodeId, usize)> = Vec::new();
            let mut active_nodes = HashSet::from([self.root_id]);

            loop {
                if !self.nodes[node_id.0].is_evaluated() {
                    if self.pending_nodes.contains(&node_id) {
                        return None;
                    }

                    return Some(self.push_pending(node_id, path, engine));
                }

                if self.nodes[node_id.0].edges.is_empty() {
                    self.backup_path(&path);
                    self.completed_visits += 1;
                    break;
                }

                let Some(edge_index) = self.select_edge(node_id, &active_nodes) else {
                    if self.nodes.get(node_id.0).is_some_and(|node| {
                        node.edges
                            .iter()
                            .any(|edge| self.pending_nodes.contains(&edge.child))
                    }) {
                        return None;
                    }

                    let edge_index = self.select_edge_allowing_cycle(node_id);
                    path.push((node_id, edge_index));
                    self.backup_cycle(&path);
                    self.completed_visits += 1;

                    if self.completed_visits >= self.config.search.visits {
                        return None;
                    }

                    break;
                };

                let action = self.nodes[node_id.0].edges[edge_index].action;
                let child = self.nodes[node_id.0].edges[edge_index].child;

                if apply_action(&mut engine, action).is_err() {
                    self.nodes[node_id.0].set_raw_value(-1.0);
                    recompute_node(&mut self.nodes, node_id);
                    self.backup_path(&path);
                    self.completed_visits += 1;
                    break;
                }

                path.push((node_id, edge_index));
                node_id = child;
                if !active_nodes.insert(node_id) {
                    self.backup_cycle(&path);
                    self.completed_visits += 1;
                    break;
                }
            }
        }
    }

    fn push_pending(
        &mut self,
        node_id: NodeId,
        path: Vec<(NodeId, usize)>,
        engine: Engine,
    ) -> PendingEvaluation {
        let id = self.next_eval_id;
        self.next_eval_id += 1;
        self.pending_nodes.insert(node_id);
        self.pending.insert(
            id,
            PendingPath {
                node_id,
                path,
                engine: engine.clone(),
            },
        );

        PendingEvaluation { id, engine }
    }

    fn expand_node(&mut self, node_id: NodeId, engine: &Engine, priors: Vec<ActionPrior>) {
        let mut edges = Vec::with_capacity(priors.len());

        for prior in priors {
            let mut child_engine = engine.clone();
            if apply_action(&mut child_engine, prior.action).is_err() {
                continue;
            }
            let child = self.intern_node(&child_engine);
            edges.push(EdgeStats::new(prior.action, child, prior.prior.max(0.0)));
        }

        self.nodes[node_id.0].edges = edges;
    }

    fn select_edge(&self, node_id: NodeId, active_nodes: &HashSet<NodeId>) -> Option<usize> {
        self.best_edge(node_id, |edge| {
            !active_nodes.contains(&edge.child) && !self.pending_nodes.contains(&edge.child)
        })
    }

    fn select_edge_allowing_cycle(&self, node_id: NodeId) -> usize {
        self.best_edge(node_id, |_| true)
            .expect("expanded graph node has at least one edge")
    }

    fn best_edge(
        &self,
        node_id: NodeId,
        mut include: impl FnMut(&EdgeStats) -> bool,
    ) -> Option<usize> {
        let node = &self.nodes[node_id.0];
        let parent_visits = node.visits.max(1) as f32;
        let mut best_index = None;
        let mut best_score = f32::NEG_INFINITY;

        for (index, edge) in node.edges.iter().enumerate() {
            if !include(edge) {
                continue;
            }

            let q = edge.mean_value();
            let u = self.config.search.cpuct * edge.prior * parent_visits.sqrt()
                / (1 + edge.visits) as f32;
            let score = q + u;

            if score > best_score {
                best_index = Some(index);
                best_score = score;
            }
        }

        best_index
    }

    fn backup_path(&mut self, path: &[(NodeId, usize)]) {
        for &(node_id, edge_index) in path.iter().rev() {
            self.nodes[node_id.0].edges[edge_index].increment_visit();
            recompute_node(&mut self.nodes, node_id);
        }
    }

    fn backup_cycle(&mut self, path: &[(NodeId, usize)]) {
        for &(node_id, edge_index) in path.iter().rev() {
            self.nodes[node_id.0].edges[edge_index].increment_visit();
            recompute_node(&mut self.nodes, node_id);
        }
    }

    fn intern_node(&mut self, engine: &Engine) -> NodeId {
        let key = PositionKey::from_engine(engine);
        if let Some(id) = self.node_by_key.get(&key) {
            return *id;
        }

        let id = NodeId(self.nodes.len());
        self.nodes.push(GraphNode::new(key.clone()));
        self.node_by_key.insert(key, id);
        id
    }
}

pub fn search<E: MctsEvaluator>(
    engine: &Engine,
    config: MctsConfig,
    evaluator: &mut E,
) -> SearchSummary {
    GraphSearch::new(config, evaluator).search(engine)
}

pub fn genmove<E: MctsEvaluator>(
    engine: &Engine,
    config: MctsConfig,
    evaluator: &mut E,
) -> Option<BotMove> {
    search(engine, config, evaluator).best_move
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RolloutConfig {
    pub limit: u32,
    pub seed: u64,
    // Baseline/fallback policy cap for random-rollout MCTS. NN evaluators
    // should provide their own priors and bypass this evaluator.
    pub max_policy_actions: Option<usize>,
}

impl Default for RolloutConfig {
    fn default() -> Self {
        Self {
            limit: 200,
            seed: 0x5e71_c0de,
            max_policy_actions: Some(64),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RandomRolloutEvaluator {
    config: RolloutConfig,
    rng: DeterministicRng,
    komi: f64,
}

impl RandomRolloutEvaluator {
    pub fn new(config: RolloutConfig, komi: f64) -> Self {
        Self {
            config,
            rng: DeterministicRng::new(config.seed),
            komi,
        }
    }
}

impl MctsEvaluator for RandomRolloutEvaluator {
    fn evaluate(&mut self, engine: &Engine, to_play: Stone) -> Evaluation {
        let actions = legal_actions(engine, to_play);
        let value = rollout_value(engine, to_play, self.config.limit, self.komi, &mut self.rng);

        Evaluation {
            value,
            priors: baseline_rollout_policy_priors(engine, actions, self.config.max_policy_actions),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RootPolicyRolloutEvaluator {
    root_key: PositionKey,
    root_value: f32,
    root_priors: Vec<ActionPrior>,
    fallback: RandomRolloutEvaluator,
}

impl RootPolicyRolloutEvaluator {
    pub fn new(
        root: &Engine,
        root_policy_logits: &[f32],
        root_value: f32,
        fallback_config: RolloutConfig,
        komi: f64,
    ) -> Self {
        let to_play = root.current_turn_stone();
        let root_value = if root_value.is_finite() {
            root_value.clamp(-1.0, 1.0)
        } else {
            0.0
        };

        Self {
            root_key: PositionKey::from_engine(root),
            root_value,
            root_priors: policy_priors_from_logits(
                root,
                to_play,
                root_policy_logits,
                fallback_config.max_policy_actions,
            ),
            fallback: RandomRolloutEvaluator::new(fallback_config, komi),
        }
    }
}

impl MctsEvaluator for RootPolicyRolloutEvaluator {
    fn evaluate(&mut self, engine: &Engine, to_play: Stone) -> Evaluation {
        if PositionKey::from_engine(engine) == self.root_key {
            return Evaluation {
                value: self.root_value,
                priors: self.root_priors.clone(),
            };
        }

        self.fallback.evaluate(engine, to_play)
    }
}

#[derive(Debug, Clone)]
struct DeterministicRng {
    state: u64,
}

impl DeterministicRng {
    fn new(seed: u64) -> Self {
        Self { state: seed.max(1) }
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.state = x;
        x
    }

    fn index(&mut self, len: usize) -> usize {
        debug_assert!(len > 0);
        (self.next_u64() as usize) % len
    }
}

pub fn uniform_priors(actions: Vec<BotMove>) -> Vec<ActionPrior> {
    if actions.is_empty() {
        return Vec::new();
    }

    let prior = 1.0 / actions.len() as f32;
    actions
        .into_iter()
        .map(|action| ActionPrior { action, prior })
        .collect()
}

pub fn policy_priors_from_logits(
    engine: &Engine,
    to_play: Stone,
    logits: &[f32],
    max_actions: Option<usize>,
) -> Vec<ActionPrior> {
    let actions = legal_actions(engine, to_play);
    if actions.is_empty() {
        return Vec::new();
    }

    let mut scored: Vec<(BotMove, f32)> = actions
        .iter()
        .filter_map(|action| {
            let index = policy_logit_index(*action, engine.cols(), engine.rows());
            let logit = logits.get(index).copied()?;

            logit.is_finite().then_some((*action, logit))
        })
        .collect();

    if scored.is_empty() {
        return uniform_priors(actions);
    }

    scored.sort_by(|(a_action, a_logit), (b_action, b_logit)| {
        b_logit
            .total_cmp(a_logit)
            .then_with(|| bot_move_order(*a_action).cmp(&bot_move_order(*b_action)))
    });

    if let Some(max_actions) = max_actions {
        scored.truncate(max_actions.max(1));
    }

    softmax_scored_priors(scored)
}

fn softmax_scored_priors(scored: Vec<(BotMove, f32)>) -> Vec<ActionPrior> {
    if scored.is_empty() {
        return Vec::new();
    }

    let max_logit = scored
        .iter()
        .map(|(_, logit)| *logit)
        .fold(f32::NEG_INFINITY, f32::max);
    let weights: Vec<(BotMove, f32)> = scored
        .iter()
        .map(|(action, logit)| (*action, (*logit - max_logit).exp()))
        .collect();
    let total: f32 = weights.iter().map(|(_, weight)| *weight).sum();

    if !total.is_finite() || total <= f32::EPSILON {
        return uniform_priors(scored.into_iter().map(|(action, _)| action).collect());
    }

    weights
        .into_iter()
        .map(|(action, weight)| ActionPrior {
            action,
            prior: weight / total,
        })
        .collect()
}

fn baseline_rollout_policy_priors(
    engine: &Engine,
    actions: Vec<BotMove>,
    max_actions: Option<usize>,
) -> Vec<ActionPrior> {
    if actions.is_empty() {
        return Vec::new();
    }

    let mut scored: Vec<(BotMove, f32)> = actions
        .into_iter()
        .map(|action| (action, baseline_rollout_policy_score(engine, action)))
        .collect();
    scored.sort_by(|(a_action, a_score), (b_action, b_score)| {
        b_score
            .total_cmp(a_score)
            .then_with(|| bot_move_order(*a_action).cmp(&bot_move_order(*b_action)))
    });

    if let Some(max_actions) = max_actions {
        scored.truncate(max_actions.max(1));
    }

    let total: f32 = scored.iter().map(|(_, score)| *score).sum();
    if total <= f32::EPSILON {
        return uniform_priors(scored.into_iter().map(|(action, _)| action).collect());
    }

    scored
        .into_iter()
        .map(|(action, score)| ActionPrior {
            action,
            prior: score / total,
        })
        .collect()
}

pub fn apply_action(engine: &mut Engine, action: BotMove) -> Result<Stage, GoError> {
    let stone = engine.current_turn_stone();

    match action {
        BotMove::Play(point) => engine.try_play(stone, point),
        BotMove::Pass => engine.try_pass(stone),
    }
}

pub fn legal_actions(engine: &Engine, to_play: Stone) -> Vec<BotMove> {
    if !matches!(
        engine.stage(),
        Stage::Unstarted | Stage::BlackToPlay | Stage::WhiteToPlay
    ) || engine.current_turn_stone() != to_play
    {
        return Vec::new();
    }

    let mut actions = Vec::with_capacity(engine.cols() as usize * engine.rows() as usize + 1);

    for row in 0..engine.rows() {
        for col in 0..engine.cols() {
            let point = (col, row);
            if engine.is_legal(point, to_play) {
                actions.push(BotMove::Play(point));
            }
        }
    }

    actions.push(BotMove::Pass);
    actions
}

fn baseline_rollout_policy_score(engine: &Engine, action: BotMove) -> f32 {
    match action {
        BotMove::Pass => 0.01,
        BotMove::Play(point) => point_policy_score(engine, point),
    }
}

fn point_policy_score(engine: &Engine, point: Point) -> f32 {
    let (col, row) = point;
    let cols = engine.cols();
    let rows = engine.rows();
    let edge_distance = [
        col,
        row,
        cols.saturating_sub(1).saturating_sub(col),
        rows.saturating_sub(1).saturating_sub(row),
    ]
    .into_iter()
    .min()
    .unwrap_or(0);
    let line_score = match edge_distance {
        0 => 0.03,
        1 => 0.25,
        2 => 1.1,
        3 => 1.25,
        _ => 0.8,
    };
    let star_bonus = if is_star_like_point(cols, rows, point) {
        2.5
    } else {
        0.0
    };
    let shape_bonus = neighbor_shape_bonus(engine, point);

    line_score + star_bonus + shape_bonus
}

fn is_star_like_point(cols: u8, rows: u8, point: Point) -> bool {
    let x_lines = star_lines(cols);
    let y_lines = star_lines(rows);

    x_lines.contains(&point.0) && y_lines.contains(&point.1)
}

fn star_lines(size: u8) -> Vec<u8> {
    if size >= 15 {
        vec![3, size / 2, size - 4]
    } else if size >= 9 {
        vec![2, size / 2, size - 3]
    } else {
        vec![size / 2]
    }
}

fn neighbor_shape_bonus(engine: &Engine, point: Point) -> f32 {
    let to_play = engine.current_turn_stone();
    let mut own_neighbors = 0;
    let mut opponent_neighbors = 0;

    for neighbor in orthogonal_neighbors(engine, point) {
        match engine.stone_at(neighbor) {
            Some(stone) if stone == to_play => own_neighbors += 1,
            Some(_) => opponent_neighbors += 1,
            None => {}
        }
    }

    0.35 * own_neighbors as f32 + 0.2 * opponent_neighbors as f32
}

fn orthogonal_neighbors(engine: &Engine, (col, row): Point) -> impl Iterator<Item = Point> + '_ {
    [
        col.checked_sub(1).map(|next_col| (next_col, row)),
        row.checked_sub(1).map(|next_row| (col, next_row)),
        col.checked_add(1)
            .filter(|next_col| *next_col < engine.cols())
            .map(|next_col| (next_col, row)),
        row.checked_add(1)
            .filter(|next_row| *next_row < engine.rows())
            .map(|next_row| (col, next_row)),
    ]
    .into_iter()
    .flatten()
}

fn bot_move_order(action: BotMove) -> (u8, u8, u8) {
    match action {
        BotMove::Play((col, row)) => (0, row, col),
        BotMove::Pass => (1, u8::MAX, u8::MAX),
    }
}

fn policy_logit_index(action: BotMove, cols: u8, rows: u8) -> usize {
    match action {
        BotMove::Play((col, row)) => row as usize * cols as usize + col as usize,
        BotMove::Pass => cols as usize * rows as usize,
    }
}

fn rollout_value(
    engine: &Engine,
    to_play: Stone,
    limit: u32,
    komi: f64,
    rng: &mut DeterministicRng,
) -> f32 {
    let mut rollout = engine.clone();

    for _ in 0..limit {
        let stone = rollout.current_turn_stone();
        let actions = legal_actions(&rollout, stone);
        if actions.is_empty() {
            break;
        }

        let action = actions[rng.index(actions.len())];
        if apply_action(&mut rollout, action).is_err() {
            break;
        }

        if !rollout.stage().is_play() {
            break;
        }
    }

    score_value(&rollout, to_play, komi)
}

fn score_value(engine: &Engine, to_play: Stone, komi: f64) -> f32 {
    let dead_stones = HashSet::new();
    let ownership = estimate_territory(engine.goban(), &dead_stones);
    let score = score(engine.goban(), &ownership, &dead_stones, komi);
    let diff = score.black_total() - score.white_total();
    let perspective_diff = match to_play {
        Stone::Black => diff,
        Stone::White => -diff,
    };

    if !engine.stage().is_play() {
        return score_diff_to_result_value(perspective_diff);
    }

    score_diff_to_score_utility(perspective_diff, engine.cols(), engine.rows())
}

fn score_diff_to_result_value(diff: f64) -> f32 {
    if diff > 0.0 {
        1.0
    } else if diff < 0.0 {
        -1.0
    } else {
        0.0
    }
}

fn score_diff_to_score_utility(diff: f64, cols: u8, rows: u8) -> f32 {
    const SCORE_UTILITY_SCALE: f64 = 2.0;

    let board_area = f64::from(cols) * f64::from(rows);
    if board_area <= 0.0 {
        return 0.0;
    }

    (diff / (SCORE_UTILITY_SCALE * board_area.sqrt())).atan() as f32 * std::f32::consts::FRAC_2_PI
}

fn pass_streak(engine: &Engine) -> u8 {
    engine
        .moves()
        .iter()
        .rev()
        .take_while(|turn| turn.is_pass())
        .count()
        .min(2) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn play(engine: &mut Engine, stone: Stone, point: Point) {
        engine.try_play(stone, point).expect("test move is legal");
    }

    #[derive(Debug)]
    struct StaticEvaluator {
        value: f32,
        priors: HashMap<BotMove, f32>,
    }

    impl MctsEvaluator for StaticEvaluator {
        fn evaluate(&mut self, engine: &Engine, to_play: Stone) -> Evaluation {
            let actions = legal_actions(engine, to_play);
            let priors = actions
                .into_iter()
                .map(|action| ActionPrior {
                    action,
                    prior: self.priors.get(&action).copied().unwrap_or(0.01),
                })
                .collect();

            Evaluation {
                value: self.value,
                priors,
            }
        }
    }

    #[test]
    fn legal_actions_include_empty_points_and_pass() {
        let engine = Engine::new(3, 3);
        let actions = legal_actions(&engine, Stone::Black);

        assert_eq!(actions.len(), 10);
        assert!(actions.contains(&BotMove::Play((0, 0))));
        assert!(actions.contains(&BotMove::Play((2, 2))));
        assert!(actions.contains(&BotMove::Pass));
    }

    #[test]
    fn legal_actions_exclude_occupied_points() {
        let mut engine = Engine::new(3, 3);
        play(&mut engine, Stone::Black, (1, 1));

        let actions = legal_actions(&engine, Stone::White);

        assert!(!actions.contains(&BotMove::Play((1, 1))));
        assert!(actions.contains(&BotMove::Pass));
    }

    #[test]
    fn legal_actions_exclude_suicide() {
        let mut engine = Engine::new(5, 5);
        play(&mut engine, Stone::Black, (0, 0));
        play(&mut engine, Stone::White, (1, 2));
        play(&mut engine, Stone::Black, (4, 4));
        play(&mut engine, Stone::White, (2, 1));
        play(&mut engine, Stone::Black, (0, 4));
        play(&mut engine, Stone::White, (3, 2));
        play(&mut engine, Stone::Black, (4, 0));
        play(&mut engine, Stone::White, (2, 3));

        let actions = legal_actions(&engine, Stone::Black);

        assert!(!actions.contains(&BotMove::Play((2, 2))));
        assert!(actions.contains(&BotMove::Pass));
    }

    #[test]
    fn legal_actions_include_captures() {
        let mut engine = Engine::new(3, 3);
        play(&mut engine, Stone::Black, (0, 1));
        play(&mut engine, Stone::White, (0, 0));
        play(&mut engine, Stone::Black, (1, 0));
        play(&mut engine, Stone::White, (2, 2));

        let actions = legal_actions(&engine, Stone::Black);

        assert!(actions.contains(&BotMove::Play((0, 0))));
    }

    #[test]
    fn legal_actions_require_side_to_play() {
        let engine = Engine::new(3, 3);

        assert!(legal_actions(&engine, Stone::White).is_empty());
    }

    #[test]
    fn legal_actions_empty_after_two_passes() {
        let mut engine = Engine::new(3, 3);
        engine.try_pass(Stone::Black).expect("black pass");
        engine.try_pass(Stone::White).expect("white pass");

        assert!(legal_actions(&engine, Stone::Black).is_empty());
    }

    #[test]
    fn uniform_priors_assign_equal_weight() {
        let priors = uniform_priors(vec![
            BotMove::Play((0, 0)),
            BotMove::Play((1, 0)),
            BotMove::Pass,
        ]);

        assert_eq!(priors.len(), 3);
        assert_eq!(priors[0].prior, 1.0 / 3.0);
        assert_eq!(priors[1].prior, 1.0 / 3.0);
        assert_eq!(priors[2].prior, 1.0 / 3.0);
    }

    #[test]
    fn uniform_priors_handles_empty_actions() {
        assert!(uniform_priors(Vec::new()).is_empty());
    }

    #[test]
    fn policy_priors_mask_illegal_moves_and_softmax_logits() {
        let mut engine = Engine::new(3, 3);
        play(&mut engine, Stone::Black, (2, 2));
        let mut logits = vec![0.0; 10];
        logits[policy_logit_index(BotMove::Play((2, 2)), 3, 3)] = 20.0;
        logits[policy_logit_index(BotMove::Play((0, 0)), 3, 3)] = 5.0;
        logits[policy_logit_index(BotMove::Pass, 3, 3)] = 4.0;

        let priors = policy_priors_from_logits(&engine, Stone::White, &logits, Some(2));
        let total: f32 = priors.iter().map(|prior| prior.prior).sum();

        assert_eq!(priors.len(), 2);
        assert_eq!(priors[0].action, BotMove::Play((0, 0)));
        assert_eq!(priors[1].action, BotMove::Pass);
        assert!(
            priors
                .iter()
                .all(|prior| prior.action != BotMove::Play((2, 2)))
        );
        assert!(priors[0].prior > priors[1].prior);
        assert!((total - 1.0).abs() < 0.0001);
    }

    #[test]
    fn root_policy_rollout_evaluator_uses_external_root_policy() {
        let engine = Engine::new(3, 3);
        let mut logits = vec![0.0; 10];
        logits[policy_logit_index(BotMove::Play((2, 2)), 3, 3)] = 8.0;
        let mut evaluator = RootPolicyRolloutEvaluator::new(
            &engine,
            &logits,
            0.75,
            RolloutConfig {
                limit: 4,
                seed: 123,
                max_policy_actions: Some(1),
            },
            0.5,
        );

        let evaluation = evaluator.evaluate(&engine, Stone::Black);

        assert_eq!(evaluation.value, 0.75);
        assert_eq!(evaluation.priors.len(), 1);
        assert_eq!(evaluation.priors[0].action, BotMove::Play((2, 2)));
        assert_eq!(evaluation.priors[0].prior, 1.0);
    }

    #[test]
    fn external_mcts_requests_root_then_child_evaluation() {
        let engine = Engine::new(3, 3);
        let mut search = ExternalMctsSearch::new(
            engine,
            ExternalMctsConfig {
                search: MctsConfig {
                    visits: 2,
                    cpuct: 1.5,
                },
                max_policy_actions: Some(2),
            },
        );
        let root = search.next_evaluations(4);
        let mut root_logits = vec![0.0; 10];
        root_logits[policy_logit_index(BotMove::Play((2, 2)), 3, 3)] = 8.0;

        assert_eq!(root.len(), 1);
        search.apply_evaluations(vec![ExternalEvaluation {
            id: root[0].id,
            policy_logits: root_logits,
            value: 0.25,
        }]);

        let child = search.next_evaluations(4);
        assert_eq!(child.len(), 1);
        search.apply_evaluations(vec![ExternalEvaluation {
            id: child[0].id,
            policy_logits: vec![0.0; 10],
            value: -0.5,
        }]);

        let summary = search.summary();
        assert_eq!(summary.visits, 2);
        assert_eq!(summary.best_move, Some(BotMove::Play((2, 2))));
        assert!((summary.root_value - 0.375).abs() < 0.0001);
        assert!(search.is_complete());
    }

    #[test]
    fn external_mcts_batches_different_pending_leaf_nodes() {
        let engine = Engine::new(3, 3);
        let mut search = ExternalMctsSearch::new(
            engine,
            ExternalMctsConfig {
                search: MctsConfig {
                    visits: 4,
                    cpuct: 1.5,
                },
                max_policy_actions: Some(4),
            },
        );
        let root = search.next_evaluations(1);

        search.apply_evaluations(vec![ExternalEvaluation {
            id: root[0].id,
            policy_logits: vec![0.0; 10],
            value: 0.0,
        }]);

        let batch = search.next_evaluations(3);
        let unique_positions: HashSet<PositionKey> = batch
            .iter()
            .map(|pending| PositionKey::from_engine(&pending.engine))
            .collect();

        assert_eq!(batch.len(), 3);
        assert_eq!(unique_positions.len(), 3);
    }

    #[test]
    fn apply_action_uses_current_turn_stone() {
        let mut engine = Engine::new(3, 3);

        apply_action(&mut engine, BotMove::Play((0, 0))).expect("play");

        assert_eq!(engine.stone_at((0, 0)), Some(Stone::Black));
        assert_eq!(engine.current_turn_stone(), Stone::White);
    }

    #[test]
    fn random_rollout_evaluator_returns_scored_priors() {
        let engine = Engine::new(3, 3);
        let mut evaluator = RandomRolloutEvaluator::new(
            RolloutConfig {
                limit: 4,
                seed: 123,
                max_policy_actions: None,
            },
            6.5,
        );

        let evaluation = evaluator.evaluate(&engine, Stone::Black);
        let center = evaluation
            .priors
            .iter()
            .find(|prior| prior.action == BotMove::Play((1, 1)))
            .expect("center prior");
        let corner = evaluation
            .priors
            .iter()
            .find(|prior| prior.action == BotMove::Play((0, 0)))
            .expect("corner prior");
        let total_prior: f32 = evaluation.priors.iter().map(|prior| prior.prior).sum();

        assert_eq!(evaluation.priors.len(), 10);
        assert!(center.prior > corner.prior);
        assert!((total_prior - 1.0).abs() < 0.0001);
        assert!((-1.0..=1.0).contains(&evaluation.value));
    }

    #[test]
    fn random_rollout_evaluator_can_cap_policy_actions() {
        let engine = Engine::new(19, 19);
        let mut evaluator = RandomRolloutEvaluator::new(
            RolloutConfig {
                limit: 4,
                seed: 123,
                max_policy_actions: Some(32),
            },
            6.5,
        );

        let evaluation = evaluator.evaluate(&engine, Stone::Black);

        assert_eq!(evaluation.priors.len(), 32);
        assert!(
            evaluation
                .priors
                .iter()
                .any(|prior| prior.action == BotMove::Play((3, 3)))
        );
        assert!(
            evaluation
                .priors
                .iter()
                .all(|prior| !matches!(prior.action, BotMove::Play((0, _))))
        );
    }

    #[test]
    fn random_rollout_evaluator_is_deterministic_for_same_seed() {
        let mut engine = Engine::new(5, 5);
        play(&mut engine, Stone::Black, (2, 2));
        play(&mut engine, Stone::White, (1, 2));
        let config = RolloutConfig {
            limit: 12,
            seed: 99,
            max_policy_actions: Some(16),
        };
        let mut a = RandomRolloutEvaluator::new(config, 6.5);
        let mut b = RandomRolloutEvaluator::new(config, 6.5);

        assert_eq!(
            a.evaluate(&engine, Stone::Black),
            b.evaluate(&engine, Stone::Black)
        );
    }

    #[test]
    fn score_value_uses_requested_perspective() {
        let mut engine = Engine::new(3, 3);
        play(&mut engine, Stone::Black, (0, 0));

        let black_value = score_value(&engine, Stone::Black, 0.5);
        let white_value = score_value(&engine, Stone::White, 0.5);

        assert!(black_value > 0.0);
        assert!(black_value < 1.0);
        assert!((black_value + white_value).abs() < 0.0001);
    }

    #[test]
    fn terminal_score_value_returns_result_sign() {
        let mut engine = Engine::new(3, 3);
        engine.try_pass(Stone::Black).expect("black pass");
        engine.try_pass(Stone::White).expect("white pass");

        assert_eq!(score_value(&engine, Stone::Black, 0.5), -1.0);
        assert_eq!(score_value(&engine, Stone::White, 0.5), 1.0);
    }

    #[test]
    fn score_utility_uses_smooth_board_scale() {
        let nine_by_nine = score_diff_to_score_utility(9.0, 9, 9);
        let nineteen_by_nineteen = score_diff_to_score_utility(9.0, 19, 19);
        let large_margin = score_diff_to_score_utility(200.0, 19, 19);

        assert!(nine_by_nine > nineteen_by_nineteen);
        assert!(nineteen_by_nineteen > 0.0);
        assert!(large_margin < 1.0);
    }

    #[test]
    fn position_key_tracks_board_turn_ko_and_pass_streak() {
        let mut a = Engine::new(3, 3);
        let mut b = Engine::new(3, 3);
        play(&mut a, Stone::Black, (0, 0));
        play(&mut b, Stone::Black, (0, 0));

        assert_eq!(PositionKey::from_engine(&a), PositionKey::from_engine(&b));

        a.try_pass(Stone::White).expect("white pass");
        assert_ne!(PositionKey::from_engine(&a), PositionKey::from_engine(&b));
        assert_eq!(PositionKey::from_engine(&a).pass_streak, 1);
    }

    #[test]
    fn graph_node_backup_is_separate_from_edge_backup() {
        let engine = Engine::new(3, 3);
        let mut node = GraphNode::new(PositionKey::from_engine(&engine));
        let mut edge = EdgeStats::new(BotMove::Pass, NodeId(1), 0.25);

        node.backup_node(0.8);
        edge.backup(-0.2);

        assert_eq!(node.visits, 1);
        assert_eq!(node.mean_value(), 0.8);
        assert_eq!(edge.visits, 1);
        assert_eq!(edge.mean_value(), -0.2);
    }

    #[test]
    fn edge_stats_are_parent_action_specific() {
        let child = NodeId(7);
        let mut from_a = EdgeStats::new(BotMove::Play((0, 0)), child, 0.7);
        let mut from_b = EdgeStats::new(BotMove::Play((1, 1)), child, 0.2);

        from_a.backup(1.0);
        from_a.backup(0.5);
        from_b.backup(-0.5);

        assert_eq!(from_a.child, from_b.child);
        assert_eq!(from_a.visits, 2);
        assert_eq!(from_b.visits, 1);
        assert_eq!(from_a.mean_value(), 0.5);
        assert_eq!(from_b.mean_value(), -0.5);
    }

    #[test]
    fn graph_node_value_recomputes_from_direct_eval_and_child_edges() {
        let engine = Engine::new(3, 3);
        let key = PositionKey::from_engine(&engine);
        let mut nodes = vec![GraphNode::new(key.clone()), GraphNode::new(key)];

        nodes[1].set_raw_value(-0.6);
        recompute_node(&mut nodes, NodeId(1));
        nodes[0].set_raw_value(0.2);
        nodes[0].push_edge(EdgeStats::new(BotMove::Play((0, 0)), NodeId(1), 1.0));
        for _ in 0..3 {
            nodes[0].edges[0].increment_visit();
        }

        recompute_node(&mut nodes, NodeId(0));

        assert_eq!(nodes[0].visits(), 4);
        assert!((nodes[0].edges()[0].mean_value() - 0.6).abs() < 0.0001);
        assert!((nodes[0].mean_value() - 0.5).abs() < 0.0001);
    }

    #[test]
    fn graph_search_skips_active_path_children_when_selecting() {
        let engine = Engine::new(3, 3);
        let key = PositionKey::from_engine(&engine);
        let mut evaluator = StaticEvaluator {
            value: 0.0,
            priors: HashMap::new(),
        };
        let mut search = GraphSearch::new(MctsConfig::default(), &mut evaluator);
        search.nodes = vec![
            GraphNode::new(key.clone()),
            GraphNode::new(key.clone()),
            GraphNode::new(key),
        ];
        search.nodes[0].push_edge(EdgeStats::new(BotMove::Pass, NodeId(1), 100.0));
        search.nodes[0].push_edge(EdgeStats::new(BotMove::Play((0, 0)), NodeId(2), 1.0));

        let active = HashSet::from([NodeId(0), NodeId(1)]);
        let all_active = HashSet::from([NodeId(0), NodeId(1), NodeId(2)]);

        assert_eq!(search.select_edge(NodeId(0), &active), Some(1));
        assert_eq!(search.select_edge(NodeId(0), &all_active), None);
    }

    #[test]
    fn cycle_backup_counts_edge_without_double_counting_child_node() {
        let engine = Engine::new(3, 3);
        let key = PositionKey::from_engine(&engine);
        let mut evaluator = StaticEvaluator {
            value: 0.0,
            priors: HashMap::new(),
        };
        let mut search = GraphSearch::new(MctsConfig::default(), &mut evaluator);
        search.nodes.push(GraphNode::new(key));
        search.nodes[0].push_edge(EdgeStats::new(BotMove::Pass, NodeId(0), 1.0));

        search.backup_cycle(&[(NodeId(0), 0)]);

        assert_eq!(search.nodes[0].visits(), 1);
        assert_eq!(search.nodes[0].edges()[0].visits(), 1);
    }

    #[test]
    fn graph_search_selection_uses_parent_perspective_edge_value() {
        let engine = Engine::new(3, 3);
        let key = PositionKey::from_engine(&engine);
        let mut evaluator = StaticEvaluator {
            value: 0.0,
            priors: HashMap::new(),
        };
        let mut search = GraphSearch::new(
            MctsConfig {
                visits: 1,
                cpuct: 0.01,
            },
            &mut evaluator,
        );
        search.nodes = vec![
            GraphNode::new(key.clone()),
            GraphNode::new(key.clone()),
            GraphNode::new(key),
        ];
        let mut good_for_parent = EdgeStats::new(BotMove::Play((0, 0)), NodeId(1), 1.0);
        good_for_parent.backup(0.8);
        let mut bad_for_parent = EdgeStats::new(BotMove::Play((1, 0)), NodeId(2), 1.0);
        bad_for_parent.backup(-0.8);
        search.nodes[0].backup_node(0.0);
        search.nodes[0].backup_node(0.0);
        search.nodes[0].push_edge(bad_for_parent);
        search.nodes[0].push_edge(good_for_parent);

        assert_eq!(search.select_edge(NodeId(0), &HashSet::new()), Some(1));
    }

    #[test]
    fn graph_search_prefers_high_prior_root_edge() {
        let engine = Engine::new(3, 3);
        let mut evaluator = StaticEvaluator {
            value: 0.0,
            priors: HashMap::from([(BotMove::Play((2, 2)), 10.0), (BotMove::Play((0, 0)), 1.0)]),
        };

        let summary = search(
            &engine,
            MctsConfig {
                visits: 12,
                cpuct: 1.5,
            },
            &mut evaluator,
        );

        assert_eq!(summary.best_move, Some(BotMove::Play((2, 2))));
        assert_eq!(summary.visits, 12);
        assert_eq!(summary.root_edges[0].action(), BotMove::Play((2, 2)));
        assert!(summary.root_edges[0].visits() > summary.root_edges[1].visits());
    }

    #[test]
    fn genmove_returns_none_when_no_actions_exist() {
        let mut engine = Engine::new(3, 3);
        engine.try_pass(Stone::Black).expect("black pass");
        engine.try_pass(Stone::White).expect("white pass");
        let mut evaluator = StaticEvaluator {
            value: 0.0,
            priors: HashMap::new(),
        };

        let best = genmove(&engine, MctsConfig::default(), &mut evaluator);

        assert_eq!(best, None);
    }
}
