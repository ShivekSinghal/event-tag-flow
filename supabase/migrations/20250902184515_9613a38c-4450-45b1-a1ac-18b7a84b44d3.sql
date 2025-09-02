-- Insert sample games
INSERT INTO public.games (name, description, price, studio) VALUES
('Cricket', 'Experience thrilling cricket gameplay with realistic physics', 50.00, 'General'),
('Russian Roulette', 'A high-stakes game of chance and nerve', 100.00, 'General');

-- Insert sample wallets
INSERT INTO public.wallets (tag_id, attendee_name, attendee_phone, balance, studio, status) VALUES
('ED001', 'John Doe', '+91-9876543210', 500.00, 'ED', 'active'),
('NDA002', 'Jane Smith', '+91-9876543211', 750.00, 'NDA', 'active');

-- Get the IDs for our inserted data (we'll need these for transactions)
-- Cricket purchase by ED studio wallet
WITH game_data AS (
  SELECT id as game_id FROM public.games WHERE name = 'Cricket'
),
wallet_data AS (
  SELECT id as wallet_id FROM public.wallets WHERE tag_id = 'ED001'
),
transaction_insert AS (
  INSERT INTO public.transactions (wallet_id, game_id, amount, type, description, reference)
  SELECT w.wallet_id, g.game_id, -50.00, 'spend', 'Purchase of Cricket game', 'GAME_PURCHASE'
  FROM wallet_data w, game_data g
  RETURNING id as transaction_id, game_id
)
INSERT INTO public.game_sales (game_id, transaction_id, quantity, sale_price)
SELECT t.game_id, t.transaction_id, 1, 50.00
FROM transaction_insert t;

-- Russian Roulette purchase by NDA studio wallet  
WITH game_data AS (
  SELECT id as game_id FROM public.games WHERE name = 'Russian Roulette'
),
wallet_data AS (
  SELECT id as wallet_id FROM public.wallets WHERE tag_id = 'NDA002'
),
transaction_insert AS (
  INSERT INTO public.transactions (wallet_id, game_id, amount, type, description, reference)
  SELECT w.wallet_id, g.game_id, -100.00, 'spend', 'Purchase of Russian Roulette game', 'GAME_PURCHASE'
  FROM wallet_data w, game_data g
  RETURNING id as transaction_id, game_id
)
INSERT INTO public.game_sales (game_id, transaction_id, quantity, sale_price)
SELECT t.game_id, t.transaction_id, 1, 100.00
FROM transaction_insert t;

-- Update wallet balances after purchases
UPDATE public.wallets 
SET balance = balance - 50.00, updated_at = now()
WHERE tag_id = 'ED001';

UPDATE public.wallets 
SET balance = balance - 100.00, updated_at = now() 
WHERE tag_id = 'NDA002';