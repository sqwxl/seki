ALTER TABLE turns
    ADD COLUMN clock_black_ms BIGINT,
    ADD COLUMN clock_white_ms BIGINT,
    ADD COLUMN clock_black_periods INTEGER,
    ADD COLUMN clock_white_periods INTEGER;
