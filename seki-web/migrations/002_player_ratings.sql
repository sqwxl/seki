alter table games add column ranked integer not null default 0;
alter table games add column rating_applied integer not null default 0;
alter table games add column black_rating_before real;
alter table games add column white_rating_before real;
alter table games add column black_deviation_before real;
alter table games add column white_deviation_before real;
alter table games add column black_volatility_before real;
alter table games add column white_volatility_before real;
alter table games add column derived_handicap integer;
alter table games add column derived_komi real;
alter table games add column derived_color_reason text;
alter table games add column calibration_policy_version text;
alter table games add column rating_result text;

create index idx_games_ranked on games (ranked);
create index idx_games_rating_applied on games (rating_applied)
where ranked = 1;

create table rating_profiles (
    user_id integer primary key references users (id) on delete cascade,
    participating integer not null default 1,
    rating real not null default 1500.0,
    deviation real not null default 350.0,
    volatility real not null default 0.06,
    rated_games integer not null default 0,
    created_at text not null default current_timestamp,
    updated_at text not null default current_timestamp
);

create index idx_rating_profiles_participating on rating_profiles (participating);
create index idx_rating_profiles_rating on rating_profiles (rating);

create table rating_adjustments (
    id integer primary key autoincrement,
    user_id integer not null references users (id) on delete cascade,
    game_id integer not null references games (id) on delete cascade,
    opponent_id integer not null references users (id) on delete cascade,
    result text not null,
    rating_before real not null,
    rating_after real not null,
    deviation_before real not null,
    deviation_after real not null,
    volatility_before real not null,
    volatility_after real not null,
    rating_delta real not null,
    opponent_rating_before real not null,
    created_at text not null default current_timestamp,
    unique (user_id, game_id)
);

create index idx_rating_adjustments_user_created
on rating_adjustments (user_id, created_at desc);

create index idx_rating_adjustments_game
on rating_adjustments (game_id);
