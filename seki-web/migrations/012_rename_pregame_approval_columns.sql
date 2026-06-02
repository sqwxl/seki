ALTER TABLE pregame_setting_negotiations
RENAME COLUMN black_approved TO creator_approved;

ALTER TABLE pregame_setting_negotiations
RENAME COLUMN white_approved TO opponent_approved;
