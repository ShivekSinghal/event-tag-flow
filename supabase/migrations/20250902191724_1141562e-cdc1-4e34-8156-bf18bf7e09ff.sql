-- Clear all test data from all tables
-- Delete in correct order to respect foreign key constraints

-- Clear game sales first (references transactions and games)
DELETE FROM public.game_sales;

-- Clear transactions next (references wallets)
DELETE FROM public.transactions;

-- Clear wallets (no dependencies)
DELETE FROM public.wallets;

-- Clear games (no dependencies)
DELETE FROM public.games;