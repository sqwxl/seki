ALTER TABLE players ADD COLUMN IF NOT EXISTS api_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_api_token ON players (api_token);
