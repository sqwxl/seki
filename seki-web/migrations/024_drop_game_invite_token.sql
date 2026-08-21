-- The legacy game invite_token/invite_only mechanism is dead: email invites
-- now mint challengee-bound one-time tokens and always fill both seats.
drop index idx_games_invite_token;
alter table games drop column invite_token;
alter table games drop column invite_only;
