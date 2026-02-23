-- Rename stage values: "done" is now split into specific terminal stages.
UPDATE games SET stage = 'completed' WHERE stage = 'done' AND result IS NOT NULL AND result NOT IN ('Aborted', 'Declined');
UPDATE games SET stage = 'aborted' WHERE stage = 'done' AND result = 'Aborted';
UPDATE games SET stage = 'declined' WHERE stage = 'done' AND result = 'Declined';
