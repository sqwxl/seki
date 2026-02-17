use chrono::{DateTime, Utc};
use go_engine::Stone;
use serde_json::json;

use crate::models::game::Game;
use crate::models::game_clock::GameClock;

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

    pub fn is_none(&self) -> bool {
        matches!(self, TimeControl::None)
    }
}

/// In-memory clock state for a game.
#[derive(Debug, Clone)]
pub struct ClockState {
    pub black_remaining_ms: i64,
    pub white_remaining_ms: i64,
    pub black_periods: i32,
    pub white_periods: i32,
    pub active_stone: Option<Stone>,
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
                active_stone: None,
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
                active_stone: None,
                last_move_at: None,
            }),
            TimeControl::Correspondence { days_per_move_secs } => Some(ClockState {
                black_remaining_ms: *days_per_move_secs as i64 * 1000,
                white_remaining_ms: *days_per_move_secs as i64 * 1000,
                black_periods: 0,
                white_periods: 0,
                active_stone: None,
                last_move_at: None,
            }),
        }
    }

    /// Restore clock state from a DB row.
    pub fn from_db(clock: &GameClock) -> Self {
        ClockState {
            black_remaining_ms: clock.black_remaining_ms,
            white_remaining_ms: clock.white_remaining_ms,
            black_periods: clock.black_periods_remaining,
            white_periods: clock.white_periods_remaining,
            active_stone: clock.active_stone.and_then(|s| Stone::from_int(s as i8)),
            last_move_at: clock.last_move_at,
        }
    }

    /// Start the clock on the first move. Black plays first, so white's clock starts ticking.
    pub fn start(&mut self, now: DateTime<Utc>) {
        self.active_stone = Some(Stone::White);
        self.last_move_at = Some(now);
    }

    /// Process a move: deduct time from the moving player, apply increment/period logic,
    /// then switch the active clock to the opponent.
    pub fn process_move(&mut self, stone: Stone, tc: &TimeControl, now: DateTime<Utc>) {
        if let Some(last) = self.last_move_at {
            if self.active_stone == Some(stone) {
                let elapsed_ms = (now - last).num_milliseconds().max(0);
                self.deduct(stone, elapsed_ms, tc);
            }
        }

        self.active_stone = Some(stone.opp());
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

    /// Real-time remaining ms for a player (deducts elapsed since last_move_at for active player).
    pub fn remaining_ms(&self, stone: Stone, now: DateTime<Utc>) -> i64 {
        let base = match stone {
            Stone::Black => self.black_remaining_ms,
            Stone::White => self.white_remaining_ms,
        };
        if self.active_stone == Some(stone) {
            if let Some(last) = self.last_move_at {
                let elapsed = (now - last).num_milliseconds().max(0);
                return base - elapsed;
            }
        }
        base
    }

    /// True if the given player's time has expired.
    pub fn is_flagged(&self, stone: Stone, now: DateTime<Utc>) -> bool {
        let remaining = self.remaining_ms(stone, now);
        let periods = match stone {
            Stone::Black => self.black_periods,
            Stone::White => self.white_periods,
        };
        remaining <= 0 && periods <= 0
    }

    /// How many ms until the active player's clock expires (for scheduling timeout task).
    pub fn ms_until_flag(&self, now: DateTime<Utc>) -> Option<i64> {
        let stone = self.active_stone?;
        let remaining = self.remaining_ms(stone, now);
        if remaining <= 0 {
            let periods = match stone {
                Stone::Black => self.black_periods,
                Stone::White => self.white_periods,
            };
            if periods <= 0 {
                return Some(0);
            }
        }
        Some(remaining.max(0))
    }

    /// Stop the active clock (for territory review, game end).
    pub fn pause(&mut self, now: DateTime<Utc>) {
        if let Some(stone) = self.active_stone {
            if let Some(last) = self.last_move_at {
                let elapsed = (now - last).num_milliseconds().max(0);
                match stone {
                    Stone::Black => self.black_remaining_ms -= elapsed,
                    Stone::White => self.white_remaining_ms -= elapsed,
                }
            }
        }
        self.active_stone = None;
        self.last_move_at = None;
    }

    /// Serialize for WS broadcast. The client computes real-time remaining from last_move_at.
    pub fn to_json(&self, tc: &TimeControl) -> serde_json::Value {
        let tc_type = match tc {
            TimeControl::None => "none",
            TimeControl::Fischer { .. } => "fischer",
            TimeControl::Byoyomi { .. } => "byoyomi",
            TimeControl::Correspondence { .. } => "correspondence",
        };
        json!({
            "type": tc_type,
            "black": {
                "remaining_ms": self.black_remaining_ms,
                "periods": self.black_periods
            },
            "white": {
                "remaining_ms": self.white_remaining_ms,
                "periods": self.white_periods
            },
            "active_stone": self.active_stone.map(|s| s.to_int() as i32),
            "last_move_at": self.last_move_at
        })
    }

    /// Convert active_stone to DB-compatible i32.
    pub fn active_stone_int(&self) -> Option<i32> {
        self.active_stone.map(|s| s.to_int() as i32)
    }
}
