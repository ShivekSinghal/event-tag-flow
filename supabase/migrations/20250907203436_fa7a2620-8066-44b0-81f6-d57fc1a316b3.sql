-- Drop the existing constraint and recreate with additional allowed values
ALTER TABLE public.transactions DROP CONSTRAINT transactions_type_check;

-- Add the updated constraint that includes POS transaction types
ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check 
CHECK (type = ANY (ARRAY['load'::text, 'spend'::text, 'refund'::text, 'games'::text, 'drinks'::text, 'food'::text]));