ALTER TABLE games ADD COLUMN territory_review_expires_at TIMESTAMPTZ;

CREATE INDEX idx_games_territory_review_expires_at
    ON games (territory_review_expires_at)
    WHERE territory_review_expires_at IS NOT NULL AND result IS NULL;
