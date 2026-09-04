-- Replay fix (4 Sep 2026): the column was created with an inline REFERENCES, so the
-- constraint already exists on a fresh database. Already-applied databases are unaffected.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_assigned_game_id_fkey;

-- Add foreign key constraint for assigned_game_id to reference games table
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_assigned_game_id_fkey 
FOREIGN KEY (assigned_game_id) REFERENCES public.games(id);