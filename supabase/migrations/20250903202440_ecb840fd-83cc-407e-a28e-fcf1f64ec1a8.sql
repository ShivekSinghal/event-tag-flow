-- Remove subcategory column from games table
ALTER TABLE public.games 
DROP COLUMN IF EXISTS subcategory;