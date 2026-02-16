-- Time control type enum
DO $$ BEGIN
    CREATE TYPE time_control_type AS ENUM ('none', 'fischer', 'byoyomi', 'correspondence');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Time control settings on games (immutable after creation)
ALTER TABLE games ADD COLUMN IF NOT EXISTS time_control time_control_type NOT NULL DEFAULT 'none';
ALTER TABLE games ADD COLUMN IF NOT EXISTS main_time_secs INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS increment_secs INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS byoyomi_time_secs INTEGER;
ALTER TABLE games ADD COLUMN IF NOT EXISTS byoyomi_periods INTEGER;

-- Clock runtime state
CREATE TABLE IF NOT EXISTS game_clocks (
    game_id BIGINT PRIMARY KEY REFERENCES games ON DELETE CASCADE,
    black_remaining_ms BIGINT NOT NULL,
    white_remaining_ms BIGINT NOT NULL,
    black_periods_remaining INTEGER NOT NULL DEFAULT 0,
    white_periods_remaining INTEGER NOT NULL DEFAULT 0,
    active_stone INTEGER,        -- 1 (black) or -1 (white), NULL if paused/game over
    last_move_at TIMESTAMPTZ,    -- when the active clock started ticking
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
