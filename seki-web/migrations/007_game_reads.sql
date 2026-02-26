CREATE TABLE game_reads (
    user_id  BIGINT NOT NULL REFERENCES users(id),
    game_id  BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    last_seen_move_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, game_id)
);
