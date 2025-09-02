-- Remove Cricket and Russian Roulette games and all related data
-- First, get the game IDs we want to delete
WITH games_to_delete AS (
  SELECT id FROM public.games 
  WHERE (name = 'Cricket' AND price = 50.00) 
     OR (name = 'Russian Roulette' AND price = 100.00)
),
-- Delete game sales records
delete_game_sales AS (
  DELETE FROM public.game_sales 
  WHERE game_id IN (SELECT id FROM games_to_delete)
),
-- Delete transaction records
delete_transactions AS (
  DELETE FROM public.transactions 
  WHERE game_id IN (SELECT id FROM games_to_delete)
)
-- Finally delete the games
DELETE FROM public.games 
WHERE id IN (SELECT id FROM games_to_delete);