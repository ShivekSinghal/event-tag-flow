-- Add constraint to ensure wallet status can only be active or blocked
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_status_check;
ALTER TABLE public.wallets ADD CONSTRAINT wallets_status_check 
CHECK (status IN ('active', 'blocked'));