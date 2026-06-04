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
    value_sum: f32,
}

impl EdgeStats {
    pub fn new(action: BotMove, child: NodeId, prior: f32) -> Self {
        Self {
            action,
            child,
            prior,
            visits: 0,
            value_sum: 0.0,
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
        if self.visits == 0 {
            0.0
        } else {
            self.value_sum / self.visits as f32
        }
    }

    pub fn backup(&mut self, value: f32) {
        self.visits += 1;
        self.value_sum += value;
    }
}

#[derive(Debug, Clone)]
pub struct GraphNode {
    key: PositionKey,
    visits: u32,
    value_sum: f32,
    edges: Vec<EdgeStats>,
}

impl GraphNode {
    pub fn new(key: PositionKey) -> Self {
        Self {
            key,
            visits: 0,
            value_sum: 0.0,
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
        if self.visits == 0 {
            0.0
        } else {
            self.value_sum / self.visits as f32
        }
    }

    pub fn backup_node(&mut self, value: f32) {
        self.visits += 1;
        self.value_sum += value;
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
            if self.nodes[node_id.0].edges.is_empty() {
                let to_play = engine.current_turn_stone();
                let evaluation = self.evaluator.evaluate(&engine, to_play);
                self.expand_node(node_id, &engine, evaluation.priors);
                self.backup(node_id, &path, evaluation.value);
                return;
            }

            let Some(edge_index) = self.select_edge(node_id, &active_nodes) else {
                let edge_index = self.select_edge_allowing_cycle(node_id);
                path.push((node_id, edge_index));
                self.backup_cycle(&path, 0.0);
                return;
            };

            let action = self.nodes[node_id.0].edges[edge_index].action;
            let child = self.nodes[node_id.0].edges[edge_index].child;

            if apply_action(&mut engine, action).is_err() {
                self.backup(node_id, &path, -1.0);
                return;
            }

            path.push((node_id, edge_index));
            node_id = child;
            if !active_nodes.insert(node_id) {
                self.backup_cycle(&path, 0.0);
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

            let q = -edge.mean_value();
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

    fn backup(&mut self, leaf_id: NodeId, path: &[(NodeId, usize)], leaf_value: f32) {
        let mut value = leaf_value;
        self.nodes[leaf_id.0].backup_node(value);

        for &(node_id, edge_index) in path.iter().rev() {
            value = -value;
            self.nodes[node_id.0].backup_node(value);
            self.nodes[node_id.0].edges[edge_index].backup(value);
        }
    }

    fn backup_cycle(&mut self, path: &[(NodeId, usize)], cycle_value: f32) {
        let mut value = cycle_value;

        for &(node_id, edge_index) in path.iter().rev() {
            self.nodes[node_id.0].backup_node(value);
            self.nodes[node_id.0].edges[edge_index].backup(value);
            value = -value;
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
}

impl Default for RolloutConfig {
    fn default() -> Self {
        Self {
            limit: 200,
            seed: 0x5e71_c0de,
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
            priors: uniform_priors(actions),
        }
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

    perspective_diff.clamp(-1.0, 1.0) as f32
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
    fn apply_action_uses_current_turn_stone() {
        let mut engine = Engine::new(3, 3);

        apply_action(&mut engine, BotMove::Play((0, 0))).expect("play");

        assert_eq!(engine.stone_at((0, 0)), Some(Stone::Black));
        assert_eq!(engine.current_turn_stone(), Stone::White);
    }

    #[test]
    fn random_rollout_evaluator_returns_uniform_priors() {
        let engine = Engine::new(3, 3);
        let mut evaluator = RandomRolloutEvaluator::new(
            RolloutConfig {
                limit: 4,
                seed: 123,
            },
            6.5,
        );

        let evaluation = evaluator.evaluate(&engine, Stone::Black);

        assert_eq!(evaluation.priors.len(), 10);
        assert_eq!(evaluation.priors[0].prior, 0.1);
        assert!((-1.0..=1.0).contains(&evaluation.value));
    }

    #[test]
    fn random_rollout_evaluator_is_deterministic_for_same_seed() {
        let mut engine = Engine::new(5, 5);
        play(&mut engine, Stone::Black, (2, 2));
        play(&mut engine, Stone::White, (1, 2));
        let config = RolloutConfig {
            limit: 12,
            seed: 99,
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

        assert_eq!(score_value(&engine, Stone::Black, 0.5), 1.0);
        assert_eq!(score_value(&engine, Stone::White, 0.5), -1.0);
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
        assert_eq!(from_a.mean_value(), 0.75);
        assert_eq!(from_b.mean_value(), -0.5);
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

        search.backup_cycle(&[(NodeId(0), 0)], 0.0);

        assert_eq!(search.nodes[0].visits(), 1);
        assert_eq!(search.nodes[0].edges()[0].visits(), 1);
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
