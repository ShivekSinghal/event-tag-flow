-- Enable realtime for transactions table
ALTER TABLE public.transactions REPLICA IDENTITY FULL;

-- Add transactions table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;