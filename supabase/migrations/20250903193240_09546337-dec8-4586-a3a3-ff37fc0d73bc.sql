-- Add foreign key constraint for assigned_game_id to reference games table
ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_assigned_game_id_fkey 
FOREIGN KEY (assigned_game_id) REFERENCES public.games(id);