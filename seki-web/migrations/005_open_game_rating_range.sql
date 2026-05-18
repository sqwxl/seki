ALTER TABLE games ADD COLUMN rating_range_mode TEXT NOT NULL DEFAULT 'unlimited'
    CHECK (rating_range_mode IN ('unlimited', 'absolute', 'asymmetric'));
ALTER TABLE games ADD COLUMN max_rating_difference_lower INTEGER;
ALTER TABLE games ADD COLUMN max_rating_difference_higher INTEGER;
ALTER TABLE games ADD COLUMN rating_difference_lower_unlimited BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE games ADD COLUMN rating_difference_higher_unlimited BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE games
SET rating_range_mode = 'absolute',
    max_rating_difference_lower = max_handicap,
    max_rating_difference_higher = max_handicap,
    rating_difference_lower_unlimited = FALSE,
    rating_difference_higher_unlimited = FALSE
WHERE max_handicap IS NOT NULL;

CREATE TABLE pregame_setting_negotiations (
    game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    handicap INTEGER NOT NULL,
    komi REAL NOT NULL,
    color TEXT NOT NULL,
    black_approved BOOLEAN NOT NULL DEFAULT FALSE,
    white_approved BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_pregame_setting_negotiations_expires_at
ON pregame_setting_negotiations (expires_at)
WHERE expires_at IS NOT NULL;
