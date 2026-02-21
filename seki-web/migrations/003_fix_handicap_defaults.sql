-- Fix games where is_handicap is false but handicap has the old default of 2.
-- Going forward, handicap >= 2 means handicap game (is_handicap is redundant).
UPDATE games SET handicap = 0 WHERE NOT is_handicap AND handicap > 0;
