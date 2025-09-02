-- Update existing wallets to have NDA as default studio if studio is null or empty
UPDATE public.wallets 
SET studio = 'NDA' 
WHERE studio IS NULL OR studio = '';