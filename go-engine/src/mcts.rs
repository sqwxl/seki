use crate::{Engine, Point, Stage, Stone};

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

pub trait MctsEvaluator {
    fn evaluate(&mut self, engine: &Engine, to_play: Stone) -> Evaluation;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn play(engine: &mut Engine, stone: Stone, point: Point) {
        engine.try_play(stone, point).expect("test move is legal");
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
}
