-- Email confirmation: user-submitted addresses sit in pending_email until
-- confirmed via a one-time link. Deliberately non-unique — several accounts
-- may pend the same address; first confirm wins.
alter table users add column pending_email text;

create table email_confirmations (
    id integer primary key autoincrement,
    user_id integer not null references users (id) on delete cascade,
    email text not null,
    token_sha256 text not null,
    expires_at text not null,
    used_at text,
    created_at text not null default current_timestamp
);

create unique index if not exists idx_email_confirmations_sha256
    on email_confirmations (token_sha256);

-- Password resets get the same O(1) token lookup. Rebuild without the argon2
-- column (it was NOT NULL UNIQUE, so SQLite can't drop it in place); old
-- outstanding reset tokens become invalid (60-minute tokens, negligible).
alter table password_resets add column token_sha256 text;

create table password_resets_new (
    id integer primary key autoincrement,
    user_id integer not null references users (id),
    token_sha256 text,
    expires_at text not null,
    used_at text,
    created_at text not null default current_timestamp
);

insert into password_resets_new (id, user_id, expires_at, used_at, created_at)
    select id, user_id, expires_at, used_at, created_at from password_resets;

drop table password_resets;
alter table password_resets_new rename to password_resets;

create unique index if not exists idx_password_resets_sha256
    on password_resets (token_sha256);
