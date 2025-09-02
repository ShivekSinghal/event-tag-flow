-- Add available column to games table to track sold out status
ALTER TABLE public.games 
ADD COLUMN available boolean NOT NULL DEFAULT true;

-- Add comment to explain the column
COMMENT ON COLUMN public.games.available IS 'Indicates if the game is available for sale (false = sold out)';