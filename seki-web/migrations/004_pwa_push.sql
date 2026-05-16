create table app_credentials (
    id integer primary key autoincrement,
    user_id integer not null references users(id) on delete cascade,
    jti text not null,
    expires_at text not null,
    revoked integer not null default 0,
    created_at text not null default current_timestamp
);

create unique index idx_app_credentials_jti on app_credentials(jti);
create index idx_app_credentials_user_id on app_credentials(user_id);

create table push_destinations (
    id integer primary key autoincrement,
    user_id integer not null references users(id) on delete cascade,
    endpoint text not null,
    p256dh text not null,
    auth text not null,
    user_agent text,
    enabled integer not null default 1,
    last_delivered_at text,
    last_failure_at text,
    failure_reason text,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

create index idx_push_destinations_user_id on push_destinations(user_id);
create unique index idx_push_destinations_endpoint on push_destinations(endpoint);

create table vapid_config (
    id integer primary key autoincrement,
    private_key text not null,
    public_key text not null,
    subject text,
    created_at text not null default current_timestamp
);
