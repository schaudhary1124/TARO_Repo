-- Migration script to add website_url and category columns to attractions table.
-- Run only after backing up your database. Example:
-- cp data.sqlite data.sqlite.bak

ALTER TABLE attractions ADD COLUMN website_url TEXT;
ALTER TABLE attractions ADD COLUMN category TEXT;

-- Optionally populate category by heuristic (example: set 'Bicycle Path' when 'trail' appears in name)
-- UPDATE attractions SET category = 'Bicycle Path' WHERE LOWER(name) LIKE '%trail%';
