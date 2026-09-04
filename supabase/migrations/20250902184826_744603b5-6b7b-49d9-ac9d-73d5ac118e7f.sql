-- Replay fix (4 Sep 2026): on a fresh database the seed transactions still point at
-- these games, so detach them first. Already-applied databases are unaffected.
UPDATE public.transactions SET game_id = NULL
WHERE game_id IN (
  SELECT id FROM public.games
  WHERE (name = 'Cricket' AND price = 50.00) OR (name = 'Russian Roulette' AND price = 100.00)
);

-- Remove Cricket and Russian Roulette games from the database
-- This will remove them from POS and all other parts of the system

-- Delete the games (this will also remove associated game_sales records due to foreign key relationships)
DELETE FROM public.games 
WHERE name = 'Cricket' AND price = 50.00;

DELETE FROM public.games 
WHERE name = 'Russian Roulette' AND price = 100.00;