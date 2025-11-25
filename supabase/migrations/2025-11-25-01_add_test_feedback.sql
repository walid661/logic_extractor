ALTER TABLE test_cases ADD COLUMN feedback text DEFAULT 'none' CHECK (feedback IN ('up','down','none'));
