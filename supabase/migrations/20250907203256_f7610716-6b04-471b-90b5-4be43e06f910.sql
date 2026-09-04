-- Check current constraints on the transactions table
-- Replay fix (4 Sep 2026): consrc was removed in Postgres 12; use pg_get_constraintdef.
SELECT conname, pg_get_constraintdef(oid) AS consrc, contype 
FROM pg_constraint 
WHERE conrelid = 'public.transactions'::regclass 
AND contype = 'c';