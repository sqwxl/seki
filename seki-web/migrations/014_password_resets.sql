create table password_resets (
    id integer primary key autoincrement,
    user_id integer not null references users(id),
    token_hash text not null unique,
    expires_at text not null,
    used_at text,
    created_at text not null default current_timestamp
);
