-- Remove sample games as they are not needed
DELETE FROM games WHERE studio IN ('ED Games', 'NDA', 'Studio A', 'Studio B');

-- Update games table to make studio field optional and clarify its purpose
COMMENT ON COLUMN games.studio IS 'Optional field for organizational purposes only - games are not dependent on studios';