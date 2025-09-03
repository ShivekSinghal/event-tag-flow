-- Add subcategory column to games table with default value
ALTER TABLE public.games 
ADD COLUMN subcategory text NOT NULL DEFAULT 'general';