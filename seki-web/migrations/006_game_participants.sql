alter table games add column opponent_id integer references users (id);

update games
set opponent_id = case
    when creator_id is null then null
    when black_id is not null and black_id != creator_id then black_id
    when white_id is not null and white_id != creator_id then white_id
    else null
end;

create index idx_games_opponent_id on games (opponent_id);
