-- Introduce Pink'D Coins while preserving legacy balance/amount columns.

CREATE TABLE IF NOT EXISTS public.coin_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inr_amount NUMERIC(10,2) NOT NULL CHECK (inr_amount > 0),
  coin_amount INTEGER NOT NULL CHECK (coin_amount > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.coin_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view active coin packages" ON public.coin_packages;
DROP POLICY IF EXISTS "Admins can view all coin packages" ON public.coin_packages;
DROP POLICY IF EXISTS "Admins can manage coin packages" ON public.coin_packages;

CREATE POLICY "Authenticated users can view active coin packages"
ON public.coin_packages
FOR SELECT
TO authenticated
USING (active = true);

CREATE POLICY "Admins can view all coin packages"
ON public.coin_packages
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can manage coin packages"
ON public.coin_packages
FOR ALL
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

GRANT SELECT ON public.coin_packages TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.coin_packages TO authenticated;

INSERT INTO public.coin_packages (inr_amount, coin_amount, active, display_order)
VALUES
  (2000, 2000, true, 1),
  (5000, 6000, true, 2),
  (10000, 13000, true, 3),
  (15000, 17000, true, 4),
  (20000, 30000, true, 5)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.pos_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('drink', 'food', 'custom_food', 'custom_game')),
  coin_price INTEGER NOT NULL DEFAULT 0 CHECK (coin_price >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (category, name)
);

ALTER TABLE public.pos_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view active POS items" ON public.pos_items;
DROP POLICY IF EXISTS "Admins can view all POS items" ON public.pos_items;
DROP POLICY IF EXISTS "Admins can manage POS items" ON public.pos_items;

CREATE POLICY "Authenticated users can view active POS items"
ON public.pos_items
FOR SELECT
TO authenticated
USING (active = true);

CREATE POLICY "Admins can view all POS items"
ON public.pos_items
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can manage POS items"
ON public.pos_items
FOR ALL
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

GRANT SELECT ON public.pos_items TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.pos_items TO authenticated;

INSERT INTO public.pos_items (name, category, coin_price, active, display_order)
VALUES
  ('Hashtag Specials', 'drink', 1000, true, 1),
  ('Classic Cocktails', 'drink', 800, true, 2),
  ('OG''s', 'drink', 800, true, 3),
  ('Mocktails/Beer', 'drink', 500, true, 4),
  ('Curry Cut Biryani', 'food', 550, true, 1),
  ('Chicken 65', 'food', 350, true, 2),
  ('Gobhi 65', 'food', 250, true, 3),
  ('Chicken Chettinad', 'food', 400, true, 4),
  ('Veg Korma', 'food', 300, true, 5),
  ('Parotta', 'food', 100, true, 6),
  ('Food Menu', 'custom_food', 500, true, 1),
  ('Dunk a Company Member', 'custom_game', 500, true, 1),
  ('Karaoke', 'custom_game', 500, true, 2)
ON CONFLICT (category, name) DO UPDATE
SET coin_price = EXCLUDED.coin_price,
    active = EXCLUDED.active,
    display_order = EXCLUDED.display_order,
    updated_at = now();

ALTER TABLE public.wallets
ADD COLUMN IF NOT EXISTS coin_balance INTEGER;

UPDATE public.wallets
SET coin_balance = GREATEST(0, ROUND(balance)::integer)
WHERE coin_balance IS NULL;

ALTER TABLE public.wallets
ALTER COLUMN coin_balance SET DEFAULT 0,
ALTER COLUMN coin_balance SET NOT NULL;

ALTER TABLE public.wallets
ADD CONSTRAINT wallets_coin_balance_nonnegative CHECK (coin_balance >= 0) NOT VALID;

ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS inr_amount NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS coin_amount INTEGER,
ADD COLUMN IF NOT EXISTS item_name TEXT,
ADD COLUMN IF NOT EXISTS item_category TEXT,
ADD COLUMN IF NOT EXISTS staff_user_id UUID REFERENCES public.profiles(id);

UPDATE public.transactions
SET
  inr_amount = CASE
    WHEN type = 'load' AND inr_amount IS NULL THEN ABS(amount)
    ELSE inr_amount
  END,
  coin_amount = CASE
    WHEN coin_amount IS NOT NULL THEN coin_amount
    WHEN type = 'load' THEN ROUND(amount)::integer
    WHEN type IN ('spend', 'games', 'drinks', 'food') THEN -ABS(ROUND(amount)::integer)
    WHEN type = 'refund' THEN ABS(ROUND(amount)::integer)
    ELSE 0
  END
WHERE inr_amount IS NULL OR coin_amount IS NULL;

ALTER TABLE public.transactions
ALTER COLUMN coin_amount SET DEFAULT 0,
ALTER COLUMN coin_amount SET NOT NULL;

ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions
ADD CONSTRAINT transactions_type_check
CHECK (type IN ('load', 'coin_purchase', 'spend', 'refund', 'games', 'drinks', 'food'));

ALTER TABLE public.games
ADD CONSTRAINT games_price_whole_coins CHECK (price >= 0 AND price = ROUND(price)) NOT VALID;

ALTER TABLE public.game_sales
ADD COLUMN IF NOT EXISTS coin_price INTEGER;

UPDATE public.game_sales
SET coin_price = ROUND(sale_price)::integer
WHERE coin_price IS NULL;

ALTER TABLE public.game_sales
ALTER COLUMN coin_price SET DEFAULT 0,
ALTER COLUMN coin_price SET NOT NULL;

ALTER TABLE public.game_sales
ADD CONSTRAINT game_sales_coin_price_nonnegative CHECK (coin_price >= 0) NOT VALID;

DROP TRIGGER IF EXISTS update_coin_packages_updated_at ON public.coin_packages;
CREATE TRIGGER update_coin_packages_updated_at
  BEFORE UPDATE ON public.coin_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_pos_items_updated_at ON public.pos_items;
CREATE TRIGGER update_pos_items_updated_at
  BEFORE UPDATE ON public.pos_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON COLUMN public.wallets.coin_balance IS 'Current Pink''D Coin balance. NFC UID remains stored in tag_id.';
COMMENT ON COLUMN public.transactions.inr_amount IS 'Real money paid in INR, populated for coin purchases/top-ups.';
COMMENT ON COLUMN public.transactions.coin_amount IS 'Pink''D Coin movement: positive for credits, negative for spends.';
COMMENT ON COLUMN public.games.price IS 'Pink''D Coin price for game/POS items.';
COMMENT ON COLUMN public.game_sales.sale_price IS 'Legacy field now representing Pink''D Coin sale price.';
