-- Check current constraints on the transactions table
SELECT conname, consrc, contype 
FROM pg_constraint 
WHERE conrelid = 'public.transactions'::regclass 
AND contype = 'c';