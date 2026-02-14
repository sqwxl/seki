CREATE TABLE IF NOT EXISTS players (
    id BIGSERIAL PRIMARY KEY,
    session_token TEXT,
    email TEXT,
    username TEXT,
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_session_token ON players (
    session_token
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_username ON players (username);

CREATE TABLE IF NOT EXISTS games (
    id BIGSERIAL PRIMARY KEY,
    creator_id BIGINT REFERENCES players (id),
    black_id BIGINT REFERENCES players (id),
    white_id BIGINT REFERENCES players (id),
    undo_requesting_player_id BIGINT REFERENCES players (id),
    invite_token TEXT,
    cols INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    komi DOUBLE PRECISION NOT NULL,
    handicap INTEGER NOT NULL,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    is_handicap BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    result TEXT,
    cached_engine_state TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_games_black_id ON games (black_id);
CREATE INDEX IF NOT EXISTS idx_games_white_id ON games (white_id);
CREATE INDEX IF NOT EXISTS idx_games_creator_id ON games (creator_id);
CREATE INDEX IF NOT EXISTS idx_games_invite_token ON games (invite_token);

CREATE TABLE IF NOT EXISTS turns (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES games (id),
    player_id BIGINT NOT NULL REFERENCES players (id),
    turn_number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    stone INTEGER NOT NULL,
    col INTEGER,
    row INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_turns_game_id ON turns (game_id);
CREATE INDEX IF NOT EXISTS idx_turns_player_id ON turns (player_id);
CREATE INDEX IF NOT EXISTS idx_turns_game_turn_number ON turns (
    game_id, turn_number
);

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES games (id),
    player_id BIGINT NOT NULL REFERENCES players (id),
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_game_id ON messages (game_id);
CREATE INDEX IF NOT EXISTS idx_messages_game_created ON messages (
    game_id, created_at
);

CREATE TABLE IF NOT EXISTS territory_reviews (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES games (id),
    black_approved BOOLEAN NOT NULL DEFAULT FALSE,
    white_approved BOOLEAN NOT NULL DEFAULT FALSE,
    settled BOOLEAN NOT NULL DEFAULT FALSE,
    black_dead_stones TEXT,
    white_dead_stones TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_territory_reviews_game_id ON territory_reviews (
    game_id
);
