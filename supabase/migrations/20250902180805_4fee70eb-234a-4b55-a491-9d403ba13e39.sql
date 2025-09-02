-- Add studio column to wallets table
ALTER TABLE public.wallets 
ADD COLUMN studio text NOT NULL DEFAULT 'NDA';