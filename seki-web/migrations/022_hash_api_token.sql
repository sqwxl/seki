-- API tokens are stored hashed (sha256) in the api_token column, like the
-- one-time tokens; the raw value is shown once at generation. Existing
-- plaintext tokens are invalidated once — users regenerate from Settings.
create table users_new (
    id integer primary key autoincrement,
    email text,
    pending_email text,
    username text not null default 'anonymous',
    password_hash text,
    api_token text,
    preferences text not null default '{}',
    is_bot integer not null default 0,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

insert into users_new (id, email, pending_email, username, password_hash, preferences, is_bot, created_at, updated_at)
    select id, email, pending_email, username, password_hash, preferences, is_bot, created_at, updated_at from users;

drop table users;
alter table users_new rename to users;

create unique index idx_users_username on users (username);
create unique index idx_users_email on users (email);
create unique index idx_users_email_ci on users (lower(email));
create unique index idx_users_api_token on users (api_token);
