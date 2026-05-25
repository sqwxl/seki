create table server_config (
    key text primary key not null,
    value text not null,
    created_at text not null default current_timestamp
);
