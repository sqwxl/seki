-- Custom-settings open games: creator pre-selects handicap/komi/color.
-- NULL creator_color = settings derived/negotiated after an opponent joins.
-- Some("black"|"white"|"random") = creator-chosen color; handicap/komi come from the game row.

ALTER TABLE games ADD COLUMN creator_color TEXT;
