-- Delete all existing data from tables
-- Delete transactions first (due to foreign key reference to wallets)
DELETE FROM public.transactions;

-- Delete all wallets
DELETE FROM public.wallets;