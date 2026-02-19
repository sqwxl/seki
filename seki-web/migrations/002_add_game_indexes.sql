-- Clock sweep runs every 5s; index avoids full table scan
CREATE INDEX idx_games_clock_expires_at ON games (clock_expires_at)
    WHERE result IS NULL AND clock_expires_at IS NOT NULL;

-- Lobby listing: filter by is_private + sort by updated_at
CREATE INDEX idx_games_public_updated ON games (updated_at DESC)
    WHERE is_private = false;
