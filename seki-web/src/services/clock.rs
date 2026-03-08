use chrono::{DateTime, TimeDelta, Utc};
use go_engine::Stone;
use serde_json::json;

use crate::models::game::Game;

/// Lag compensation tracker (Lichess quota system).
///
/// Each player has an independent budget of compensatable lag (in ms).
/// Per move the server measures `elapsed - client_move_time` to isolate network
/// overhead, then credits back `min(lag, quota)` so only real thinking time is
/// charged. The quota regenerates each move, bounded by `quota_max`.
#[derive(Debug, Clone)]
pub struct LagTracker {
    /// Current compensatable budget (ms).
    pub quota_ms: i64,
    /// Amount regenerated per move (ms).
    quota_gain_ms: i64,
    /// Ceiling on banked quota (ms).
    quota_max_ms: i64,
}

/// Baseline CPU/rendering lag added to measured frame lag (Lichess: 14cs = 140ms).
const ESTIMATED_CPU_LAG_MS: i64 = 140;
/// Maximum recordable lag per move (Lichess: 2000cs = 20_000ms).
const LAG_RECORDING_CAP_MS: i64 = 20_000;
/// Maximum flag grace (Lichess: 200cs = 2000ms).
const FLAG_GRACE_MAX_MS: i64 = 2000;

impl LagTracker {
    /// Create a new tracker scaled to the time control.
    pub fn new(tc: &TimeControl) -> Self {
        let est_secs = tc.estimated_total_seconds();
        // Lichess formula: quota_gain = min(100cs, est_secs * 2/5 + 15cs)
        // Converted to ms: min(1000, est_secs * 400/1000 + 150)
        let quota_gain_ms = 1000_i64.min(est_secs * 2 / 5 + 150);
        let initial = quota_gain_ms * 3;
        let quota_max_ms = quota_gain_ms * 7;
        LagTracker {
            quota_ms: initial.min(quota_max_ms),
            quota_gain_ms,
            quota_max_ms,
        }
    }

    /// Record a move's lag and return the compensation (ms to credit back).
    ///
    /// `server_elapsed_ms`: time the server measured between moves.
    /// `client_move_time_ms`: thinking time the client reported (None if unavailable).
    pub fn record_lag(&mut self, server_elapsed_ms: i64, client_move_time_ms: Option<i64>) -> i64 {
        let lag = match client_move_time_ms {
            Some(client_ms) => {
                let raw_lag = (server_elapsed_ms - client_ms.max(0)).max(0);
                // Add estimated CPU lag, cap total
                (raw_lag + ESTIMATED_CPU_LAG_MS).min(LAG_RECORDING_CAP_MS)
            }
            // Without client timing, we can't measure lag — no compensation
            None => return 0,
        };

        let comp = lag.min(self.quota_ms);
        self.quota_ms = (self.quota_ms + self.quota_gain_ms - comp).min(self.quota_max_ms);
        comp
    }

    /// Grace period to subtract before flagging (ms).
    pub fn flag_grace_ms(&self) -> i64 {
        self.quota_ms.min(FLAG_GRACE_MAX_MS)
    }
}

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

    /// Rough estimate of total game seconds (for lag quota scaling).
    /// Assumes ~80 moves per player for a typical Go game.
    pub fn estimated_total_seconds(&self) -> i64 {
        match self {
            TimeControl::None | TimeControl::Correspondence { .. } => 0,
            TimeControl::Fischer {
                main_time_secs,
                increment_secs,
            } => *main_time_secs as i64 + *increment_secs as i64 * 80,
            TimeControl::Byoyomi {
                main_time_secs,
                period_time_secs,
                periods,
            } => *main_time_secs as i64 + *period_time_secs as i64 * *periods as i64,
        }
    }
}

/// Derive the active clock stone from the game stage string.
/// Returns `Some(stone)` if a user's clock should be ticking, `None` if paused.
pub fn active_stone_from_stage(stage: &str) -> Option<Stone> {
    match stage {
        "black_to_play" => Some(Stone::Black),
        "white_to_play" => Some(Stone::White),
        _ => None,
    }
}

/// In-memory clock state for a game. Tracks time values only — the active
/// user is derived from the game stage, not stored here.
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

    /// Process a move: deduct time from the moving user, apply increment/period logic,
    /// then record the move timestamp.
    pub fn process_move(
        &mut self,
        stone: Stone,
        active_stone: Option<Stone>,
        tc: &TimeControl,
        now: DateTime<Utc>,
    ) {
        if let Some(last) = self.last_move_at
            && active_stone == Some(stone)
        {
            let elapsed_ms = (now - last).num_milliseconds().max(0);
            self.deduct(stone, elapsed_ms, tc);
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

    /// Real-time remaining ms for a user (deducts elapsed since last_move_at if active).
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
        if active_stone == Some(stone)
            && let Some(last) = self.last_move_at
        {
            return base - (now - last).num_milliseconds().max(0);
        }
        base
    }

    /// Total remaining ms for a user including byoyomi periods.
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
                remaining + periods as i64 * period_ms
            }
            _ => remaining,
        }
    }

    /// True if the given user's time has expired (accounting for byoyomi periods).
    pub fn is_flagged(
        &self,
        stone: Stone,
        active_stone: Option<Stone>,
        tc: &TimeControl,
        now: DateTime<Utc>,
    ) -> bool {
        self.total_remaining_ms(stone, active_stone, tc, now) <= 0
    }

    /// Compute the absolute time at which the active user's clock expires.
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

    /// Resume a paused clock by setting last_move_at (inverse of pause).
    pub fn resume(&mut self, now: DateTime<Utc>) {
        self.last_move_at = Some(now);
    }

    /// Deduct elapsed time for the active user and clear last_move_at (pauses the clock).
    pub fn pause(&mut self, active_stone: Option<Stone>, now: DateTime<Utc>) {
        if let Some(stone) = active_stone
            && let Some(last) = self.last_move_at
        {
            let elapsed = (now - last).num_milliseconds().max(0);
            match stone {
                Stone::Black => self.black_remaining_ms -= elapsed,
                Stone::White => self.white_remaining_ms -= elapsed,
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
        let server_now_ms = now.timestamp_millis();
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
            "active_stone": self.last_move_at.and(active_stone).map(|s| s.to_int() as i32),
            "server_now_ms": server_now_ms
        })
    }
}

/// Data for persisting clock state to the `games` table.
pub struct ClockUpdate {
    pub black_ms: i64,
    pub white_ms: i64,
    pub black_periods: i32,
    pub white_periods: i32,
    pub active_stone: Option<i32>,
    pub last_move_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
}

impl ClockState {
    pub fn to_update(&self, active_stone: Option<Stone>, tc: &TimeControl) -> ClockUpdate {
        let now = Utc::now();
        ClockUpdate {
            black_ms: self.black_remaining_ms,
            white_ms: self.white_remaining_ms,
            black_periods: self.black_periods,
            white_periods: self.white_periods,
            active_stone: active_stone.map(|s| s.to_int() as i32),
            last_move_at: self.last_move_at,
            expires_at: self.expiration(active_stone, tc, now),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fischer_30m() -> TimeControl {
        TimeControl::Fischer {
            main_time_secs: 1800,
            increment_secs: 0,
        }
    }

    fn fischer_1m() -> TimeControl {
        TimeControl::Fischer {
            main_time_secs: 60,
            increment_secs: 0,
        }
    }

    fn byoyomi_10m() -> TimeControl {
        TimeControl::Byoyomi {
            main_time_secs: 600,
            period_time_secs: 30,
            periods: 3,
        }
    }

    // -- estimated_total_seconds --

    #[test]
    fn estimated_total_fischer() {
        let tc = TimeControl::Fischer {
            main_time_secs: 600,
            increment_secs: 10,
        };
        // 600 + 10 * 80 = 1400
        assert_eq!(tc.estimated_total_seconds(), 1400);
    }

    #[test]
    fn estimated_total_byoyomi() {
        let tc = byoyomi_10m();
        // 600 + 30 * 3 = 690
        assert_eq!(tc.estimated_total_seconds(), 690);
    }

    #[test]
    fn estimated_total_none_and_correspondence() {
        assert_eq!(TimeControl::None.estimated_total_seconds(), 0);
        let tc = TimeControl::Correspondence {
            days_per_move_secs: 259200,
        };
        assert_eq!(tc.estimated_total_seconds(), 0);
    }

    // -- LagTracker::new --

    #[test]
    fn lag_tracker_30m_game() {
        let t = LagTracker::new(&fischer_30m());
        // est = 1800, gain = min(1000, 1800*2/5 + 150) = min(1000, 870) = 870
        assert_eq!(t.quota_gain_ms, 870);
        assert_eq!(t.quota_ms, 870 * 3); // initial = gain * 3
        assert_eq!(t.quota_max_ms, 870 * 7);
    }

    #[test]
    fn lag_tracker_1m_game() {
        let t = LagTracker::new(&fischer_1m());
        // est = 60, gain = min(1000, 60*2/5 + 150) = min(1000, 174) = 174
        assert_eq!(t.quota_gain_ms, 174);
        assert_eq!(t.quota_ms, 174 * 3);
    }

    #[test]
    fn lag_tracker_gain_capped_at_1000() {
        // Very long game: gain formula exceeds 1000
        let tc = TimeControl::Fischer {
            main_time_secs: 7200,
            increment_secs: 30,
        };
        let t = LagTracker::new(&tc);
        assert_eq!(t.quota_gain_ms, 1000);
    }

    #[test]
    fn lag_tracker_none_tc() {
        let t = LagTracker::new(&TimeControl::None);
        // est = 0, gain = min(1000, 0 + 150) = 150
        assert_eq!(t.quota_gain_ms, 150);
    }

    // -- record_lag --

    #[test]
    fn no_compensation_without_client_time() {
        let mut t = LagTracker::new(&fischer_30m());
        let initial_quota = t.quota_ms;
        let comp = t.record_lag(5000, None);
        assert_eq!(comp, 0);
        assert_eq!(t.quota_ms, initial_quota); // quota unchanged
    }

    #[test]
    fn compensate_network_lag() {
        let mut t = LagTracker::new(&fischer_30m());
        // Server measured 1200ms, client says 1000ms thinking → 200ms raw lag + 140 cpu = 340ms
        let comp = t.record_lag(1200, Some(1000));
        assert_eq!(comp, 340);
    }

    #[test]
    fn compensation_bounded_by_quota() {
        let tc = fischer_1m();
        let mut t = LagTracker::new(&tc);
        let initial_quota = t.quota_ms; // 174 * 3 = 522

        // Huge lag: server 10000ms, client 0ms → lag = min(10000 + 140, 20000) = 10140
        // But comp = min(10140, 522) = 522
        let comp = t.record_lag(10000, Some(0));
        assert_eq!(comp, initial_quota);
    }

    #[test]
    fn quota_regenerates_each_move() {
        let mut t = LagTracker::new(&fischer_30m());
        // Small lag: 50ms raw + 140 cpu = 190ms comp, well within quota
        let comp1 = t.record_lag(1050, Some(1000));
        assert_eq!(comp1, 190);
        // quota = min(initial + gain - 190, max)
        let expected = 870 * 3 + 870 - 190;
        assert_eq!(t.quota_ms, expected);
    }

    #[test]
    fn quota_depletes_under_sustained_abuse() {
        let mut t = LagTracker::new(&fischer_30m());
        // Claim 0ms thinking every move — burns quota faster than gain replenishes
        for _ in 0..20 {
            t.record_lag(5000, Some(0));
        }
        // After many moves of abuse, quota stabilizes at gain level
        // (comp = min(5140, quota), quota = quota + gain - comp)
        // Steady state: comp = quota, so quota + gain - quota = gain → quota ≈ gain
        assert!(t.quota_ms <= t.quota_gain_ms + 1);
    }

    #[test]
    fn negative_client_time_clamped_to_zero() {
        let mut t = LagTracker::new(&fischer_30m());
        // Negative client time treated as 0
        let comp_neg = t.record_lag(1000, Some(-500));

        let mut t2 = LagTracker::new(&fischer_30m());
        let comp_zero = t2.record_lag(1000, Some(0));

        assert_eq!(comp_neg, comp_zero);
    }

    #[test]
    fn client_time_exceeding_server_elapsed() {
        let mut t = LagTracker::new(&fischer_30m());
        // Client claims more thinking time than server measured → raw_lag = 0
        // lag = 0 + 140 (cpu baseline) = 140ms
        let comp = t.record_lag(500, Some(800));
        assert_eq!(comp, ESTIMATED_CPU_LAG_MS);
    }

    #[test]
    fn lag_capped_at_recording_limit() {
        let mut t = LagTracker::new(&fischer_30m());
        // Enormous lag: 30000ms server, 0ms client → raw = 30000 + 140 = 30140
        // Capped at LAG_RECORDING_CAP_MS = 20000
        let comp = t.record_lag(30000, Some(0));
        // comp = min(20000, quota)
        let expected = LAG_RECORDING_CAP_MS.min(870 * 3);
        assert_eq!(comp, expected);
    }

    // -- flag_grace_ms --

    #[test]
    fn flag_grace_bounded_by_max() {
        let t = LagTracker::new(&fischer_30m());
        // Initial quota = 2610, FLAG_GRACE_MAX_MS = 2000
        assert!(t.quota_ms > FLAG_GRACE_MAX_MS);
        assert_eq!(t.flag_grace_ms(), FLAG_GRACE_MAX_MS);
    }

    #[test]
    fn flag_grace_uses_remaining_quota_when_low() {
        let tc = fischer_1m();
        let mut t = LagTracker::new(&tc);
        // Deplete quota
        for _ in 0..20 {
            t.record_lag(5000, Some(0));
        }
        assert!(t.quota_ms < FLAG_GRACE_MAX_MS);
        assert_eq!(t.flag_grace_ms(), t.quota_ms);
    }

    // -- to_json includes server_now_ms --

    #[test]
    fn clock_json_includes_server_now() {
        let clock = ClockState {
            black_remaining_ms: 60000,
            white_remaining_ms: 60000,
            black_periods: 0,
            white_periods: 0,
            last_move_at: None,
        };
        let tc = fischer_1m();
        let json = clock.to_json(&tc, None);
        assert!(json.get("server_now_ms").is_some());
        let server_now = json["server_now_ms"].as_i64().unwrap();
        let now_ms = Utc::now().timestamp_millis();
        // Should be within 1 second of now
        assert!((now_ms - server_now).abs() < 1000);
    }
}
