ALTER TABLE territory_reviews DROP COLUMN IF EXISTS black_dead_stones;
ALTER TABLE territory_reviews DROP COLUMN IF EXISTS white_dead_stones;
ALTER TABLE territory_reviews ADD COLUMN IF NOT EXISTS dead_stones JSONB;
