-- Enums

CREATE TYPE time_control_type AS ENUM (
    'none',
    'fischer',
    'byoyomi',
    'correspondence'
);

-- Players

CREATE TABLE players (
    id BIGSERIAL PRIMARY KEY,
    session_token TEXT,
    email TEXT,
    username TEXT NOT NULL DEFAULT 'anonymous',
    password_hash TEXT,
    api_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_players_session_token ON players (session_token);
CREATE UNIQUE INDEX idx_players_email ON players (email);
CREATE UNIQUE INDEX idx_players_username ON players (username);
CREATE UNIQUE INDEX idx_players_api_token ON players (api_token);

-- Games

CREATE TABLE games (
    id BIGSERIAL PRIMARY KEY,
    creator_id BIGINT REFERENCES players (id),
    black_id BIGINT REFERENCES players (id),
    white_id BIGINT REFERENCES players (id),
    invite_token TEXT,
    cols INTEGER NOT NULL,
    rows INTEGER NOT NULL,
    komi DOUBLE PRECISION NOT NULL,
    handicap INTEGER NOT NULL,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    is_handicap BOOLEAN NOT NULL DEFAULT FALSE,
    allow_undo BOOLEAN NOT NULL DEFAULT FALSE,
    stage TEXT NOT NULL DEFAULT 'unstarted',
    undo_rejected BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    result TEXT,
    cached_engine_state TEXT,
    time_control time_control_type NOT NULL DEFAULT 'none',
    main_time_secs INTEGER,
    increment_secs INTEGER,
    byoyomi_time_secs INTEGER,
    byoyomi_periods INTEGER,
    clock_black_ms BIGINT,
    clock_white_ms BIGINT,
    clock_black_periods INTEGER DEFAULT 0,
    clock_white_periods INTEGER DEFAULT 0,
    clock_active_stone INTEGER,
    clock_last_move_at TIMESTAMPTZ,
    clock_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_games_creator_id ON games (creator_id);
CREATE INDEX idx_games_black_id ON games (black_id);
CREATE INDEX idx_games_white_id ON games (white_id);
CREATE INDEX idx_games_invite_token ON games (invite_token);

-- Turns

CREATE TABLE turns (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES games (id),
    player_id BIGINT NOT NULL REFERENCES players (id),
    turn_number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    stone INTEGER NOT NULL,
    col INTEGER,
    "row" INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_turns_game_id ON turns (game_id);
CREATE INDEX idx_turns_player_id ON turns (player_id);
CREATE INDEX idx_turns_game_turn_number ON turns (game_id, turn_number);

-- Messages

CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES games (id),
    player_id BIGINT REFERENCES players (id),
    text TEXT NOT NULL,
    move_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_game_id ON messages (game_id);
CREATE INDEX idx_messages_game_created ON messages (game_id, created_at);

-- Territory reviews

CREATE TABLE territory_reviews (
    id BIGSERIAL PRIMARY KEY,
    game_id BIGINT NOT NULL REFERENCES games (id),
    black_approved BOOLEAN NOT NULL DEFAULT FALSE,
    white_approved BOOLEAN NOT NULL DEFAULT FALSE,
    settled BOOLEAN NOT NULL DEFAULT FALSE,
    dead_stones JSONB,
    black_territory INTEGER,
    black_captures INTEGER,
    white_territory INTEGER,
    white_captures INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_territory_reviews_game_id ON territory_reviews (game_id);
