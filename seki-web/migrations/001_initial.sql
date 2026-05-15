create table users (
    id integer primary key autoincrement,
    session_token text,
    email text,
    username text not null default 'anonymous',
    password_hash text,
    api_token text,
    preferences text not null default '{}',
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

create unique index idx_users_session_token on users (session_token);
create unique index idx_users_email on users (email);
create unique index idx_users_username on users (username);
create unique index idx_users_api_token on users (api_token);

create table games (
    id integer primary key autoincrement,
    creator_id integer references users (id),
    black_id integer references users (id),
    white_id integer references users (id),
    access_token text,
    invite_token text,
    cols integer not null,
    "rows" integer not null,
    komi real not null,
    handicap integer not null,
    is_private integer not null default 0,
    allow_undo integer not null default 0,
    stage text not null default 'unstarted',
    undo_rejected integer not null default 0,
    started_at text,
    ended_at text,
    result text,
    cached_engine_state text,
    time_control text not null default 'none'
    check (time_control in ('none', 'fischer', 'byoyomi', 'correspondence')),
    main_time_secs integer,
    increment_secs integer,
    byoyomi_time_secs integer,
    byoyomi_periods integer,
    clock_black_ms integer,
    clock_white_ms integer,
    clock_black_periods integer default 0,
    clock_white_periods integer default 0,
    clock_active_stone integer,
    clock_last_move_at text,
    clock_expires_at text,
    territory_review_expires_at text,
    nigiri integer not null default 0,
    open_to text,
    invite_only integer not null default 0,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

create index idx_games_creator_id on games (creator_id);
create index idx_games_black_id on games (black_id);
create index idx_games_white_id on games (white_id);
create index idx_games_access_token on games (access_token);
create index idx_games_invite_token on games (invite_token);
create index idx_games_clock_expires_at on games (clock_expires_at)
where result is null and clock_expires_at is not null;
create index idx_games_public_updated on games (updated_at desc)
where is_private = 0;
create index idx_games_territory_review_expires_at
on games (territory_review_expires_at)
where territory_review_expires_at is not null and result is null;

create table turns (
    id integer primary key autoincrement,
    game_id integer not null references games (id),
    user_id integer not null references users (id),
    turn_number integer not null,
    kind text not null,
    stone integer not null,
    col integer,
    "row" integer,
    clock_black_ms integer,
    clock_white_ms integer,
    clock_black_periods integer,
    clock_white_periods integer,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

create index idx_turns_game_id on turns (game_id);
create index idx_turns_user_id on turns (user_id);
create index idx_turns_game_turn_number on turns (game_id, turn_number);

create table messages (
    id integer primary key autoincrement,
    game_id integer not null references games (id),
    user_id integer references users (id),
    "text" text not null,
    move_number integer,
    client_message_id text,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp,
    unique (game_id, user_id, client_message_id)
);

create index idx_messages_game_id on messages (game_id);
create index idx_messages_game_created on messages (game_id, created_at);

create table territory_reviews (
    id integer primary key autoincrement,
    game_id integer not null references games (id),
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

create index idx_territory_reviews_game_id on territory_reviews (game_id);

create table game_reads (
    user_id integer not null references users (id),
    game_id integer not null references games (id) on delete cascade,
    last_seen_move_count integer not null default 0,
    primary key (user_id, game_id)
);
