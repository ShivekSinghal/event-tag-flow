-- Harden Pink'D coin wallet operations, fulfillment tracking, and exposed policies.

-- Remove the retired package. The 10000 -> 14000 package is intentionally preserved.
DELETE FROM public.coin_packages
WHERE inr_amount = 15000;

ALTER TABLE public.event_order_items
ADD COLUMN IF NOT EXISTS coin_amount INTEGER,
ADD COLUMN IF NOT EXISTS coin_fulfillment_status TEXT NOT NULL DEFAULT 'not_applicable',
ADD COLUMN IF NOT EXISTS coin_fulfilled_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS coin_fulfilled_wallet_id UUID REFERENCES public.wallets(id);

ALTER TABLE public.event_order_items DROP CONSTRAINT IF EXISTS event_order_items_coin_fulfillment_status_check;
ALTER TABLE public.event_order_items
ADD CONSTRAINT event_order_items_coin_fulfillment_status_check
CHECK (coin_fulfillment_status IN ('not_applicable', 'pending_venue_load', 'fulfilled', 'cancelled'));

UPDATE public.event_order_items
SET
  coin_amount = COALESCE(coin_amount, NULLIF(regexp_replace(package_name, '\D', '', 'g'), '')::INTEGER),
  coin_fulfillment_status = CASE
    WHEN package_category = 'coins' AND coin_fulfillment_status = 'not_applicable' THEN 'pending_venue_load'
    ELSE coin_fulfillment_status
  END
WHERE package_category = 'coins';

UPDATE public.event_order_items
SET coin_fulfillment_status = 'not_applicable'
WHERE package_category <> 'coins';

CREATE OR REPLACE FUNCTION public.set_event_order_item_coin_fulfillment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.package_category = 'coins' OR NEW.package_key LIKE 'coin-package:%' THEN
    NEW.coin_amount := COALESCE(
      NEW.coin_amount,
      NULLIF(regexp_replace(NEW.package_name, '\D', '', 'g'), '')::INTEGER
    );
    IF NEW.coin_fulfillment_status IS NULL OR NEW.coin_fulfillment_status = 'not_applicable' THEN
      NEW.coin_fulfillment_status := 'pending_venue_load';
    END IF;
  ELSE
    NEW.coin_amount := NULL;
    NEW.coin_fulfillment_status := 'not_applicable';
    NEW.coin_fulfilled_at := NULL;
    NEW.coin_fulfilled_wallet_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_event_order_item_coin_fulfillment ON public.event_order_items;
CREATE TRIGGER set_event_order_item_coin_fulfillment
  BEFORE INSERT OR UPDATE ON public.event_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_event_order_item_coin_fulfillment();

CREATE OR REPLACE FUNCTION public.credit_wallet_coins(
  p_wallet_id UUID,
  p_coin_package_id UUID,
  p_payment_reference TEXT
)
RETURNS TABLE (
  wallet_id UUID,
  new_coin_balance INTEGER,
  credited_coin_amount INTEGER,
  inr_amount NUMERIC,
  transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_package public.coin_packages%ROWTYPE;
  v_transaction_id UUID;
  v_reference TEXT;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.get_current_user_role() NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can credit coins';
  END IF;

  v_reference := NULLIF(TRIM(p_payment_reference), '');
  IF v_reference IS NULL THEN
    RAISE EXCEPTION 'Payment reference is required before crediting coins';
  END IF;

  SELECT *
  INTO v_package
  FROM public.coin_packages
  WHERE id = p_coin_package_id
    AND active = true;

  IF v_package.id IS NULL THEN
    RAISE EXCEPTION 'Active coin package not found';
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_wallet.status = 'blocked' THEN
    RAISE EXCEPTION 'Wallet is blocked';
  END IF;

  UPDATE public.wallets
  SET
    coin_balance = COALESCE(coin_balance, 0) + v_package.coin_amount,
    balance = COALESCE(coin_balance, 0) + v_package.coin_amount,
    updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.transactions (
    wallet_id,
    type,
    amount,
    inr_amount,
    coin_amount,
    description,
    reference,
    staff_user_id
  )
  VALUES (
    v_wallet.id,
    'coin_purchase',
    v_package.coin_amount,
    v_package.inr_amount,
    v_package.coin_amount,
    'Pink''D Coin package purchase',
    v_reference,
    (select auth.uid())
  )
  RETURNING id INTO v_transaction_id;

  RETURN QUERY
  SELECT v_wallet.id, v_wallet.coin_balance, v_package.coin_amount, v_package.inr_amount, v_transaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.spend_wallet_coins(
  p_wallet_id UUID,
  p_coin_amount INTEGER,
  p_transaction_type TEXT,
  p_item_name TEXT,
  p_item_category TEXT DEFAULT NULL,
  p_game_id UUID DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS TABLE (
  wallet_id UUID,
  new_coin_balance INTEGER,
  spent_coin_amount INTEGER,
  transaction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_transaction_id UUID;
  v_type TEXT;
  v_item_name TEXT;
  v_reference TEXT;
BEGIN
  IF (select auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF public.get_current_user_role() NOT IN ('admin', 'staff') THEN
    RAISE EXCEPTION 'Only admins and staff can spend coins';
  END IF;

  v_type := COALESCE(NULLIF(TRIM(p_transaction_type), ''), 'food');
  IF v_type NOT IN ('games', 'drinks', 'food') THEN
    RAISE EXCEPTION 'Invalid transaction type';
  END IF;

  IF p_coin_amount IS NULL OR p_coin_amount <= 0 THEN
    RAISE EXCEPTION 'Coin amount must be greater than zero';
  END IF;

  v_item_name := COALESCE(NULLIF(TRIM(p_item_name), ''), 'POS Item');
  v_reference := COALESCE(NULLIF(TRIM(p_reference), ''), UPPER(v_type) || '_' || extract(epoch from clock_timestamp())::bigint::text);

  SELECT *
  INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_wallet.status = 'blocked' THEN
    RAISE EXCEPTION 'Wallet is blocked';
  END IF;

  IF COALESCE(v_wallet.coin_balance, 0) < p_coin_amount THEN
    RAISE EXCEPTION 'Insufficient Pink''D Coins';
  END IF;

  UPDATE public.wallets
  SET
    coin_balance = COALESCE(coin_balance, 0) - p_coin_amount,
    balance = COALESCE(coin_balance, 0) - p_coin_amount,
    updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.transactions (
    wallet_id,
    type,
    amount,
    inr_amount,
    coin_amount,
    description,
    reference,
    game_id,
    item_name,
    item_category,
    staff_user_id
  )
  VALUES (
    v_wallet.id,
    v_type,
    -p_coin_amount,
    NULL,
    -p_coin_amount,
    CASE
      WHEN v_type = 'drinks' THEN 'Drinks Purchase: '
      WHEN v_type = 'games' THEN 'Game Purchase: '
      ELSE 'Food Purchase: '
    END || v_item_name,
    v_reference,
    p_game_id,
    v_item_name,
    COALESCE(NULLIF(TRIM(p_item_category), ''), v_type),
    (select auth.uid())
  )
  RETURNING id INTO v_transaction_id;

  IF p_game_id IS NOT NULL THEN
    INSERT INTO public.game_sales (
      game_id,
      transaction_id,
      quantity,
      sale_price,
      coin_price
    )
    VALUES (
      p_game_id,
      v_transaction_id,
      1,
      p_coin_amount,
      p_coin_amount
    );
  END IF;

  RETURN QUERY
  SELECT v_wallet.id, v_wallet.coin_balance, p_coin_amount, v_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet_coins(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_wallet_coins(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.spend_wallet_coins(UUID, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_wallet_coins(UUID, INTEGER, TEXT, TEXT, TEXT, UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Allow all operations on wallets" ON public.wallets;
DROP POLICY IF EXISTS "Allow all operations on transactions" ON public.transactions;
DROP POLICY IF EXISTS "Allow all operations on games" ON public.games;
DROP POLICY IF EXISTS "Allow all operations on game_sales" ON public.game_sales;

DROP POLICY IF EXISTS "Admins and operators can view wallets" ON public.wallets;
DROP POLICY IF EXISTS "Admins and studio managers can create wallets" ON public.wallets;
DROP POLICY IF EXISTS "Admins can update wallet status" ON public.wallets;

CREATE POLICY "Admins and operators can view wallets"
ON public.wallets
FOR SELECT
TO authenticated
USING (public.get_current_user_role() IN ('admin', 'staff', 'studio_manager'));

CREATE POLICY "Admins and studio managers can create wallets"
ON public.wallets
FOR INSERT
TO authenticated
WITH CHECK (public.get_current_user_role() IN ('admin', 'studio_manager'));

CREATE POLICY "Admins can update wallet status"
ON public.wallets
FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins and operators can view transactions" ON public.transactions;
CREATE POLICY "Admins and operators can view transactions"
ON public.transactions
FOR SELECT
TO authenticated
USING (public.get_current_user_role() IN ('admin', 'staff', 'studio_manager'));

DROP POLICY IF EXISTS "Authenticated users can view games" ON public.games;
DROP POLICY IF EXISTS "Admins can manage games" ON public.games;
CREATE POLICY "Authenticated users can view games"
ON public.games
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage games"
ON public.games
FOR ALL
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

DROP POLICY IF EXISTS "Admins and staff can view game sales" ON public.game_sales;
CREATE POLICY "Admins and staff can view game sales"
ON public.game_sales
FOR SELECT
TO authenticated
USING (public.get_current_user_role() IN ('admin', 'staff'));

DROP POLICY IF EXISTS "Admins can update coin fulfillment" ON public.event_order_items;
CREATE POLICY "Admins can update coin fulfillment"
ON public.event_order_items
FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

REVOKE ALL ON public.wallets FROM anon;
REVOKE ALL ON public.transactions FROM anon;
REVOKE ALL ON public.games FROM anon;
REVOKE ALL ON public.game_sales FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.wallets FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.game_sales FROM authenticated;
GRANT SELECT ON public.wallets, public.transactions, public.games, public.game_sales TO authenticated;
GRANT INSERT ON public.wallets TO authenticated;
GRANT UPDATE (status, updated_at) ON public.wallets TO authenticated;
GRANT UPDATE (coin_fulfillment_status, coin_fulfilled_at, coin_fulfilled_wallet_id) ON public.event_order_items TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.user_has_permission(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_permission(UUID, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_event_order_item_coin_fulfillment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.event_order_items.coin_amount IS 'Pink''D Coins sold through landing-page checkout, pending venue wallet load unless fulfilled.';
COMMENT ON COLUMN public.event_order_items.coin_fulfillment_status IS 'Venue fulfillment status for coin-package line items; event checkout does not auto-credit NFC wallets.';
