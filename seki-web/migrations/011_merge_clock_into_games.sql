-- Merge clock state from game_clocks into games table.
-- All columns nullable — NULL for untimed games.
-- clock_expires_at is a precomputed absolute timestamp for efficient sweep queries.

ALTER TABLE games
  ADD COLUMN clock_black_ms BIGINT,
  ADD COLUMN clock_white_ms BIGINT,
  ADD COLUMN clock_black_periods INTEGER DEFAULT 0,
  ADD COLUMN clock_white_periods INTEGER DEFAULT 0,
  ADD COLUMN clock_active_stone INTEGER,
  ADD COLUMN clock_last_move_at TIMESTAMPTZ,
  ADD COLUMN clock_expires_at TIMESTAMPTZ;

-- Migrate existing clock data
UPDATE games SET
  clock_black_ms = gc.black_remaining_ms,
  clock_white_ms = gc.white_remaining_ms,
  clock_black_periods = gc.black_periods_remaining,
  clock_white_periods = gc.white_periods_remaining,
  clock_active_stone = gc.active_stone,
  clock_last_move_at = gc.last_move_at
FROM game_clocks gc WHERE gc.game_id = games.id;

DROP TABLE game_clocks;
