create table if not exists game_challenge_tokens (
    id integer primary key autoincrement,
    game_id integer not null references games (id) on delete cascade,
    user_id integer not null references users (id) on delete cascade,
    token_hash text not null,
    expires_at text not null,
    used_at text,
    created_at text not null default current_timestamp
);

create index if not exists idx_game_challenge_tokens_game_id
    on game_challenge_tokens (game_id);
