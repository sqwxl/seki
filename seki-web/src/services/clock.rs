use chrono::{DateTime, TimeDelta, Utc};
use go_engine::Stone;
use serde_json::json;

use crate::models::game::Game;

/// Rich time control variant with parameters, constructed from Game fields.
#[derive(Debug, Clone)]
pub enum TimeControl {
    None,
    Fischer {
        main_time_secs: i32,
        increment_secs: i32,
    },
    Byoyomi {
        main_time_secs: i32,
        period_time_secs: i32,
        periods: i32,
    },
    Correspondence {
        days_per_move_secs: i32,
    },
}

impl TimeControl {
    pub fn from_game(game: &Game) -> Self {
        use crate::models::game::TimeControlType;
        match game.time_control {
            TimeControlType::None => TimeControl::None,
            TimeControlType::Fischer => TimeControl::Fischer {
                main_time_secs: game.main_time_secs.unwrap_or(600),
                increment_secs: game.increment_secs.unwrap_or(5),
            },
            TimeControlType::Byoyomi => TimeControl::Byoyomi {
                main_time_secs: game.main_time_secs.unwrap_or(1200),
                period_time_secs: game.byoyomi_time_secs.unwrap_or(30),
                periods: game.byoyomi_periods.unwrap_or(3),
            },
            TimeControlType::Correspondence => TimeControl::Correspondence {
                days_per_move_secs: game.main_time_secs.unwrap_or(259200), // 3 days
            },
        }
    }

    /// Build from raw time control type and optional parameters (for use before game row exists).
    pub fn from_tc_type(
        tc_type: crate::models::game::TimeControlType,
        main_time_secs: Option<i32>,
        increment_secs: Option<i32>,
        byoyomi_time_secs: Option<i32>,
        byoyomi_periods: Option<i32>,
    ) -> Self {
        use crate::models::game::TimeControlType;
        match tc_type {
            TimeControlType::None => TimeControl::None,
            TimeControlType::Fischer => TimeControl::Fischer {
                main_time_secs: main_time_secs.unwrap_or(600),
                increment_secs: increment_secs.unwrap_or(5),
            },
            TimeControlType::Byoyomi => TimeControl::Byoyomi {
                main_time_secs: main_time_secs.unwrap_or(1200),
                period_time_secs: byoyomi_time_secs.unwrap_or(30),
                periods: byoyomi_periods.unwrap_or(3),
            },
            TimeControlType::Correspondence => TimeControl::Correspondence {
                days_per_move_secs: main_time_secs.unwrap_or(259200),
            },
        }
    }

    pub fn is_none(&self) -> bool {
        matches!(self, TimeControl::None)
    }
}

/// Derive the active clock stone from the game stage string.
/// Returns `Some(stone)` if a player's clock should be ticking, `None` if paused.
pub fn active_stone_from_stage(stage: &str) -> Option<Stone> {
    match stage {
        "black_to_play" => Some(Stone::Black),
        "white_to_play" => Some(Stone::White),
        _ => None,
    }
}

/// In-memory clock state for a game. Tracks time values only — the active
/// player is derived from the game stage, not stored here.
#[derive(Debug, Clone)]
pub struct ClockState {
    pub black_remaining_ms: i64,
    pub white_remaining_ms: i64,
    pub black_periods: i32,
    pub white_periods: i32,
    pub last_move_at: Option<DateTime<Utc>>,
}

impl ClockState {
    /// Create initial clock state from time control settings.
    pub fn new(tc: &TimeControl) -> Option<Self> {
        match tc {
            TimeControl::None => None,
            TimeControl::Fischer { main_time_secs, .. } => Some(ClockState {
                black_remaining_ms: *main_time_secs as i64 * 1000,
                white_remaining_ms: *main_time_secs as i64 * 1000,
                black_periods: 0,
                white_periods: 0,
                last_move_at: None,
            }),
            TimeControl::Byoyomi {
                main_time_secs,
                periods,
                ..
            } => Some(ClockState {
                black_remaining_ms: *main_time_secs as i64 * 1000,
                white_remaining_ms: *main_time_secs as i64 * 1000,
                black_periods: *periods,
                white_periods: *periods,
                last_move_at: None,
            }),
            TimeControl::Correspondence { days_per_move_secs } => Some(ClockState {
                black_remaining_ms: *days_per_move_secs as i64 * 1000,
                white_remaining_ms: *days_per_move_secs as i64 * 1000,
                black_periods: 0,
                white_periods: 0,
                last_move_at: None,
            }),
        }
    }

    /// Restore clock state from the game row.
    pub fn from_game(game: &Game) -> Option<Self> {
        let black_ms = game.clock_black_ms?;
        let white_ms = game.clock_white_ms?;
        Some(ClockState {
            black_remaining_ms: black_ms,
            white_remaining_ms: white_ms,
            black_periods: game.clock_black_periods.unwrap_or(0),
            white_periods: game.clock_white_periods.unwrap_or(0),
            last_move_at: game.clock_last_move_at,
        })
    }

    /// Record that the clock has started ticking (first move).
    pub fn start(&mut self, now: DateTime<Utc>) {
        self.last_move_at = Some(now);
    }

    /// Process a move: deduct time from the moving player, apply increment/period logic,
    /// then record the move timestamp.
    pub fn process_move(
        &mut self,
        stone: Stone,
        active_stone: Option<Stone>,
        tc: &TimeControl,
        now: DateTime<Utc>,
    ) {
        if let Some(last) = self.last_move_at {
            if active_stone == Some(stone) {
                let elapsed_ms = (now - last).num_milliseconds().max(0);
                self.deduct(stone, elapsed_ms, tc);
            }
        }

        self.last_move_at = Some(now);
    }

    fn deduct(&mut self, stone: Stone, elapsed_ms: i64, tc: &TimeControl) {
        let (remaining, periods) = match stone {
            Stone::Black => (&mut self.black_remaining_ms, &mut self.black_periods),
            Stone::White => (&mut self.white_remaining_ms, &mut self.white_periods),
        };

        match tc {
            TimeControl::Fischer { increment_secs, .. } => {
                *remaining -= elapsed_ms;
                *remaining += *increment_secs as i64 * 1000;
            }
            TimeControl::Byoyomi {
                period_time_secs, ..
            } => {
                let period_ms = *period_time_secs as i64 * 1000;
                if *remaining > 0 {
                    *remaining -= elapsed_ms;
                    if *remaining < 0 {
                        // Overflow into byo-yomi
                        let overflow = -*remaining;
                        *remaining = period_ms - overflow;
                        if *remaining < 0 {
                            *periods -= 1;
                            *remaining = period_ms;
                        }
                    }
                } else if elapsed_ms <= period_ms {
                    // Made it in time, reset period timer
                    *remaining = period_ms;
                } else {
                    // Spent too long, lose a period
                    *periods -= 1;
                    *remaining = period_ms;
                }
            }
            TimeControl::Correspondence { days_per_move_secs } => {
                *remaining = *days_per_move_secs as i64 * 1000;
            }
            TimeControl::None => {}
        }
    }

    /// Real-time remaining ms for a player (deducts elapsed since last_move_at if active).
    pub fn remaining_ms(
        &self,
        stone: Stone,
        active_stone: Option<Stone>,
        now: DateTime<Utc>,
    ) -> i64 {
        let base = match stone {
            Stone::Black => self.black_remaining_ms,
            Stone::White => self.white_remaining_ms,
        };
        if active_stone == Some(stone) {
            if let Some(last) = self.last_move_at {
                let elapsed = (now - last).num_milliseconds().max(0);
                return base - elapsed;
            }
        }
        base
    }

    /// Total remaining ms for a player including byoyomi periods.
    fn total_remaining_ms(
        &self,
        stone: Stone,
        active_stone: Option<Stone>,
        tc: &TimeControl,
        now: DateTime<Utc>,
    ) -> i64 {
        let remaining = self.remaining_ms(stone, active_stone, now);
        let periods = match stone {
            Stone::Black => self.black_periods,
            Stone::White => self.white_periods,
        };
        match tc {
            TimeControl::Byoyomi {
                period_time_secs, ..
            } => {
                let period_ms = *period_time_secs as i64 * 1000;
                if remaining <= 0 {
                    periods as i64 * period_ms + remaining
                } else {
                    remaining + periods as i64 * period_ms
                }
            }
            _ => remaining,
        }
    }

    /// True if the given player's time has expired (accounting for byoyomi periods).
    pub fn is_flagged(
        &self,
        stone: Stone,
        active_stone: Option<Stone>,
        tc: &TimeControl,
        now: DateTime<Utc>,
    ) -> bool {
        self.total_remaining_ms(stone, active_stone, tc, now) <= 0
    }

    /// Compute the absolute time at which the active player's clock expires.
    pub fn expiration(
        &self,
        active_stone: Option<Stone>,
        tc: &TimeControl,
        now: DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        let stone = active_stone?;
        let total_ms = self.total_remaining_ms(stone, active_stone, tc, now);
        if total_ms <= 0 {
            return Some(now);
        }
        Some(now + TimeDelta::milliseconds(total_ms))
    }

    /// Deduct elapsed time for the active player and clear last_move_at (pauses the clock).
    pub fn pause(&mut self, active_stone: Option<Stone>, now: DateTime<Utc>) {
        if let Some(stone) = active_stone {
            if let Some(last) = self.last_move_at {
                let elapsed = (now - last).num_milliseconds().max(0);
                match stone {
                    Stone::Black => self.black_remaining_ms -= elapsed,
                    Stone::White => self.white_remaining_ms -= elapsed,
                }
            }
        }
        self.last_move_at = None;
    }

    /// Serialize for WS broadcast. `active_stone` is derived from game stage
    /// and included so the client doesn't need to duplicate the derivation.
    pub fn to_json(&self, tc: &TimeControl, active_stone: Option<Stone>) -> serde_json::Value {
        let tc_type = match tc {
            TimeControl::None => "none",
            TimeControl::Fischer { .. } => "fischer",
            TimeControl::Byoyomi { .. } => "byoyomi",
            TimeControl::Correspondence { .. } => "correspondence",
        };
        let now = Utc::now();
        json!({
            "type": tc_type,
            "black": {
                "remaining_ms": self.remaining_ms(Stone::Black, active_stone, now),
                "periods": self.black_periods
            },
            "white": {
                "remaining_ms": self.remaining_ms(Stone::White, active_stone, now),
                "periods": self.white_periods
            },
            "active_stone": self.last_move_at.and(active_stone).map(|s| s.to_int() as i32)
        })
    }
}
