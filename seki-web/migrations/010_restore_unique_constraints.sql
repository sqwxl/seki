-- Restore dropped unique constraints on messages and turns

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_unique
    ON messages (game_id, user_id, client_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_unique
    ON turns (game_id, turn_number);
