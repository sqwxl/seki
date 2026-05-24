#!/usr/bin/env bash
set -euo pipefail

DB="${1:-seki.db}"

if [ ! -f "$DB" ]; then
    echo "Database not found: $DB" >&2
    exit 1
fi

sqlite3 "$DB" <<'SQL'
-- Collect bot user and game IDs
CREATE TEMP TABLE bot_users AS SELECT id FROM users WHERE username LIKE 'random-bot-%';
CREATE TEMP TABLE bot_games AS
    SELECT g.id FROM games g
    WHERE g.creator_id IN (SELECT id FROM bot_users)
       OR g.opponent_id IN (SELECT id FROM bot_users)
       OR g.black_id     IN (SELECT id FROM bot_users)
       OR g.white_id     IN (SELECT id FROM bot_users);

-- Delete games — cascades to turns, messages, territory_reviews,
-- game_reads, pregame_setting_negotiations, rating_history
DELETE FROM games WHERE id IN (SELECT id FROM bot_games);

-- Delete users — cascades to rating_profiles, push_subscriptions, fcm_tokens
DELETE FROM users WHERE id IN (SELECT id FROM bot_users);

DROP TABLE bot_users;
DROP TABLE bot_games;
SQL

echo "Purged bot artifacts from $DB"
