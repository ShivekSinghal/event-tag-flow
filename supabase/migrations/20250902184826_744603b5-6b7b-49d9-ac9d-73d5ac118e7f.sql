-- Remove Cricket and Russian Roulette games from the database
-- This will remove them from POS and all other parts of the system

-- Delete the games (this will also remove associated game_sales records due to foreign key relationships)
DELETE FROM public.games 
WHERE name = 'Cricket' AND price = 50.00;

DELETE FROM public.games 
WHERE name = 'Russian Roulette' AND price = 100.00;