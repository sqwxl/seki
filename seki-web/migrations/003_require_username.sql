-- Backfill existing players that have no username
UPDATE players SET username = 'anon-' || id WHERE username IS NULL;

-- Make username required
ALTER TABLE players ALTER COLUMN username SET NOT NULL;
ALTER TABLE players ALTER COLUMN username SET DEFAULT 'anonymous';
