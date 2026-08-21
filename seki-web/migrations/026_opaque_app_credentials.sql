-- App credentials become opaque tokens stored as sha256, like every other
-- token in the app; the legacy JWT (with its signing secret) is gone.
-- Existing credentials are invalidated once — the PWA re-issues on next load.
create table app_credentials_new (
    id integer primary key autoincrement,
    user_id integer not null references users(id) on delete cascade,
    token_hash text not null,
    expires_at text not null,
    revoked integer not null default 0,
    created_at text not null default current_timestamp
);

insert into app_credentials_new (id, user_id, expires_at, revoked, created_at)
    select id, user_id, expires_at, revoked, created_at from app_credentials;

drop table app_credentials;
alter table app_credentials_new rename to app_credentials;

create unique index idx_app_credentials_token_hash on app_credentials(token_hash);
create index idx_app_credentials_user_id on app_credentials(user_id);
