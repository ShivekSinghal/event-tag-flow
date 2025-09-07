-- Check current constraints on the transactions table using the correct syntax
SELECT conname, pg_get_constraintdef(oid) as constraint_def, contype 
FROM pg_constraint 
WHERE conrelid = 'public.transactions'::regclass 
AND contype = 'c';