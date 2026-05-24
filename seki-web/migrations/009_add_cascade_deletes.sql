-- Recreate turns, messages, and territory_reviews with ON DELETE CASCADE on game_id

PRAGMA foreign_keys = OFF;

-- turns
CREATE TABLE turns_new (
    id integer primary key autoincrement,
    game_id integer not null references games (id) on delete cascade,
    user_id integer not null references users (id),
    turn_number integer not null,
    kind text not null,
    stone integer not null,
    col integer,
    row integer,
    clock_black_ms integer,
    clock_white_ms integer,
    clock_black_periods integer,
    clock_white_periods integer,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

INSERT INTO turns_new SELECT * FROM turns;
DROP TABLE turns;
ALTER TABLE turns_new RENAME TO turns;

CREATE INDEX IF NOT EXISTS idx_turns_game_id ON turns (game_id);
CREATE INDEX IF NOT EXISTS idx_turns_user_id ON turns (user_id);
CREATE INDEX IF NOT EXISTS idx_turns_game_turn_number ON turns (game_id, turn_number);

-- messages
CREATE TABLE messages_new (
    id integer primary key autoincrement,
    game_id integer not null references games (id) on delete cascade,
    user_id integer references users (id),
    text text not null,
    move_number integer,
    client_message_id text,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

INSERT INTO messages_new SELECT * FROM messages;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX IF NOT EXISTS idx_messages_game_id ON messages (game_id);
CREATE INDEX IF NOT EXISTS idx_messages_game_created ON messages (game_id, created_at);

-- territory_reviews
CREATE TABLE territory_reviews_new (
    id integer primary key autoincrement,
    game_id integer not null references games (id) on delete cascade,
    black_approved integer not null default 0,
    white_approved integer not null default 0,
    settled integer not null default 0,
    dead_stones text,
    black_territory integer,
    black_captures integer,
    white_territory integer,
    white_captures integer,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

INSERT INTO territory_reviews_new SELECT * FROM territory_reviews;
DROP TABLE territory_reviews;
ALTER TABLE territory_reviews_new RENAME TO territory_reviews;

CREATE INDEX IF NOT EXISTS idx_territory_reviews_game_id ON territory_reviews (game_id);

PRAGMA foreign_keys = ON;
