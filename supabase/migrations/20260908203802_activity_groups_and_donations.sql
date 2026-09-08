-- Activity metadata is additive; historic rows and game IDs remain intact.
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS activity_group text NOT NULL DEFAULT 'other';
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'fixed';
UPDATE public.games SET pricing_mode = 'free' WHERE price = 0;

-- Production already has the other fourteen activities. Do not manufacture replacements
-- on databases without those operational records; the release preflight checks the roster.
INSERT INTO public.games(name, description, studio, price, available, activity_group, pricing_mode)
SELECT 'Busk for a Cause', 'Choose a donation of at least 150 Pink''D Coins', 'General', 150, true, 'donations', 'donation'
WHERE NOT EXISTS (SELECT 1 FROM public.games WHERE lower(trim(name)) = 'busk for a cause');

DO $$
DECLARE r record; v_id uuid;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Shoot Your Shot', 'tier_1', 'fixed', 450),
    ('Spin the Wheel', 'tier_1', 'fixed', 450),
    ('Wing Person for Hire', 'tier_1', 'fixed', 450),
    ('Hurdle', 'tier_2', 'fixed', 750),
    ('Cricket', 'tier_2', 'fixed', 750),
    ('Issue With a Tissue', 'tier_2', 'fixed', 750),
    ('Limbo', 'tier_3', 'fixed', 1000),
    ('Bombastic', 'tier_3', 'fixed', 1000),
    ('Minute to Win It', 'tier_3', 'fixed', 1000),
    ('Red Flag Green Flag', 'free', 'free', 0),
    ('Jamaal Challenge', 'free', 'free', 0),
    ('Squid Games', 'free', 'free', 0),
    ('Beer Pong', 'free', 'free', 0),
    ('Karaoke', 'donations', 'donation', 150),
    ('Busk for a Cause', 'donations', 'donation', 150)
  ) AS activity(name, grp, mode, coins) LOOP
    SELECT id INTO v_id FROM public.games WHERE lower(trim(name)) = lower(r.name)
      ORDER BY available DESC, created_at, id LIMIT 1;
    IF v_id IS NOT NULL THEN
      UPDATE public.games SET activity_group=r.grp, pricing_mode=r.mode, price=r.coins,
        available=true, awards_pinkredible=CASE WHEN r.mode='fixed' THEN awards_pinkredible ELSE false END
      WHERE id=v_id;
      UPDATE public.games SET available=false WHERE lower(trim(name))=lower(r.name) AND id<>v_id;
    END IF;
  END LOOP;
END $$;
-- Known obsolete aliases remain historical, not additional sale options.
UPDATE public.games SET available=false WHERE name IN ('Hurdles', 'Issue with the Tissue');
UPDATE public.pos_items SET active=false WHERE category='custom_game'
  AND lower(trim(name)) IN (SELECT lower(trim(name)) FROM public.games WHERE activity_group <> 'other');

ALTER TABLE public.games ADD CONSTRAINT games_activity_group_check
  CHECK (activity_group IN ('tier_1','tier_2','tier_3','free','donations','other'));
ALTER TABLE public.games ADD CONSTRAINT games_pricing_mode_check
  CHECK (pricing_mode IN ('fixed','free','donation'));
ALTER TABLE public.games ADD CONSTRAINT games_activity_pricing_check CHECK (
  (activity_group NOT IN ('tier_1','tier_2','tier_3') OR pricing_mode='fixed')
  AND (activity_group <> 'free' OR pricing_mode='free')
  AND (activity_group <> 'donations' OR pricing_mode='donation')
  AND (pricing_mode <> 'free' OR (price=0 AND NOT awards_pinkredible))
  AND (pricing_mode <> 'donation' OR (price>=150 AND price=trunc(price) AND NOT awards_pinkredible))
  AND (activity_group='other' OR pricing_mode<>'fixed' OR (price>0 AND price=trunc(price)))
);

-- NUMERIC preserves the caller's original value so a direct fractional RPC cannot
-- be rounded by PostgreSQL's integer argument cast before validation.
DROP FUNCTION public.spend_wallet_coins(uuid, integer, text, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.spend_wallet_coins(
  p_wallet_id UUID,
  p_coin_amount NUMERIC,
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
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_game public.games%ROWTYPE;
  v_transaction_id UUID;
  v_type TEXT;
  v_item_name TEXT;
  v_reference TEXT;
  v_role TEXT := public.get_current_user_role();
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'staff', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins, staff and studio managers can spend coins';
  END IF;

  v_type := COALESCE(NULLIF(TRIM(p_transaction_type), ''), 'food');
  IF v_type NOT IN ('games', 'drinks', 'food') THEN
    RAISE EXCEPTION 'Invalid transaction type';
  END IF;

  IF v_role <> 'admin' AND NOT coalesce(public.user_has_permission(
    (SELECT auth.uid()),
    CASE WHEN v_type = 'games' THEN 'game' ELSE v_type END,
    CASE WHEN v_type = 'games' THEN p_game_id ELSE NULL END
  ), false) THEN
    RAISE EXCEPTION 'This % sale is not assigned to your account', v_type;
  END IF;

  IF p_coin_amount IS NULL OR p_coin_amount::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_coin_amount <= 0 OR p_coin_amount > 2147483647 OR p_coin_amount <> trunc(p_coin_amount) THEN
    RAISE EXCEPTION 'Coin amount must be a positive whole number';
  END IF;

  IF v_type = 'games' THEN
    SELECT * INTO v_game FROM public.games WHERE id = p_game_id FOR SHARE;
    IF v_game.id IS NULL OR NOT v_game.available THEN
      RAISE EXCEPTION 'Activity is unavailable. Refresh and select an active activity.';
    END IF;
    IF v_game.pricing_mode = 'free' THEN
      RAISE EXCEPTION 'Free activities do not take payments or scan bands';
    END IF;
    IF v_game.pricing_mode = 'donation' AND p_coin_amount < greatest(150, v_game.price) THEN
      RAISE EXCEPTION 'Donation must be at least % coins', greatest(150, v_game.price);
    END IF;
    IF v_game.pricing_mode = 'fixed' AND p_coin_amount <> v_game.price THEN
      RAISE EXCEPTION 'Activity price changed. Refresh and select the activity again.';
    END IF;
  ELSIF p_game_id IS NOT NULL THEN
    RAISE EXCEPTION 'Activity payments must use the games transaction type';
  END IF;

  v_item_name := COALESCE(v_game.name, NULLIF(TRIM(p_item_name), ''), 'POS Item');
  v_reference := COALESCE(NULLIF(TRIM(p_reference), ''), UPPER(v_type) || '_' || extract(epoch from clock_timestamp())::bigint::text);

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Wallet is %', v_wallet.status;
  END IF;
  IF COALESCE(v_wallet.coin_balance, 0) < p_coin_amount THEN
    RAISE EXCEPTION 'Insufficient Pink''D Coins';
  END IF;

  UPDATE public.wallets
  SET coin_balance = COALESCE(coin_balance, 0) - p_coin_amount,
      balance = COALESCE(coin_balance, 0) - p_coin_amount,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.transactions (
    wallet_id, type, amount, inr_amount, coin_amount, description, reference,
    game_id, item_name, item_category, staff_user_id
  ) VALUES (
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
    COALESCE(v_game.activity_group, NULLIF(TRIM(p_item_category), ''), v_type),
    (SELECT auth.uid())
  ) RETURNING id INTO v_transaction_id;

  IF p_game_id IS NOT NULL THEN
    INSERT INTO public.game_sales (game_id, transaction_id, quantity, sale_price, coin_price)
    VALUES (p_game_id, v_transaction_id, 1, p_coin_amount, p_coin_amount);
  END IF;

  RETURN QUERY
  SELECT v_wallet.id, v_wallet.coin_balance, p_coin_amount::integer, v_transaction_id;
END;
$$;
REVOKE ALL ON FUNCTION public.spend_wallet_coins(uuid,numeric,text,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.spend_wallet_coins(uuid,numeric,text,text,text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.execute_wallet_operation(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := coalesce(public.get_current_user_role(), '');
  v_kind text := p_request->>'kind';
  v_operation public.wallet_operations%ROWTYPE;
  v_result jsonb;
  v_package public.coin_packages%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_role NOT IN ('admin', 'staff', 'studio_manager') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in with a permitted operator account';
  END IF;
  IF p_operation_id IS NULL OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
    OR v_kind IS NULL OR v_kind NOT IN ('spend', 'topup') THEN
    RAISE EXCEPTION 'Valid operation ID and payment request are required';
  END IF;
  -- Recheck privileges even when replaying a completed operation.
  IF v_kind = 'topup' AND v_role NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only admins and studio managers can credit coins';
  END IF;
  IF v_kind = 'spend' THEN
    IF coalesce(p_request->>'transaction_type', '') NOT IN ('games', 'drinks', 'food') THEN
      RAISE EXCEPTION 'Invalid transaction type';
    END IF;
    IF v_role <> 'admin' AND NOT coalesce(public.user_has_permission(v_actor,
      CASE WHEN p_request->>'transaction_type' = 'games' THEN 'game' ELSE p_request->>'transaction_type' END,
      CASE WHEN p_request->>'transaction_type' = 'games' THEN (p_request->>'game_id')::uuid ELSE NULL END), false) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This sale is not assigned to your account';
    END IF;
  END IF;

  -- A concurrent insert waits for the first transaction. Wallet movement and receipt
  -- either commit together or both disappear; there is no externally visible pending row.
  INSERT INTO public.wallet_operations(operation_id, operator_id, operation_kind, request)
  VALUES (p_operation_id, v_actor, v_kind, p_request) ON CONFLICT DO NOTHING;
  SELECT * INTO v_operation FROM public.wallet_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF v_operation.operator_id <> v_actor OR v_operation.request IS DISTINCT FROM p_request THEN
    RAISE EXCEPTION USING ERRCODE = 'P2001', MESSAGE = 'Operation ID belongs to a different operator or payment request';
  END IF;
  IF v_operation.result IS NOT NULL THEN RETURN v_operation.result; END IF;

  BEGIN
    IF v_kind = 'spend' THEN
      -- Inspect the JSON value before any integer conversion. Successful replays above
      -- remain recoverable even after activity configuration changes.
      IF jsonb_typeof(p_request->'coin_amount') IS DISTINCT FROM 'number'
        OR (p_request->>'coin_amount')::numeric <= 0
        OR (p_request->>'coin_amount')::numeric > 2147483647
        OR (p_request->>'coin_amount')::numeric <> trunc((p_request->>'coin_amount')::numeric) THEN
        RAISE EXCEPTION 'Coin amount must be a positive whole number';
      END IF;
      SELECT to_jsonb(r) || jsonb_build_object('status', 'succeeded') INTO v_result
      FROM public.spend_wallet_coins(
        (p_request->>'wallet_id')::uuid, (p_request->>'coin_amount')::numeric,
        p_request->>'transaction_type', p_request->>'item_name', p_request->>'item_category',
        (p_request->>'game_id')::uuid, p_request->>'reference') r;
    ELSE
      SELECT * INTO v_package FROM public.coin_packages WHERE id = (p_request->>'coin_package_id')::uuid FOR SHARE;
      IF v_package.id IS NULL OR NOT v_package.active
        OR v_package.coin_amount IS DISTINCT FROM (p_request->>'expected_coin_amount')::integer
        OR v_package.inr_amount IS DISTINCT FROM (p_request->>'expected_inr_amount')::numeric THEN
        RAISE EXCEPTION 'The package changed. Confirm the payment amount and select the current package before a new top-up.';
      END IF;
      SELECT to_jsonb(r) || jsonb_build_object('status', 'succeeded') INTO v_result
      FROM public.credit_wallet_coins((p_request->>'wallet_id')::uuid,
        (p_request->>'coin_package_id')::uuid, p_request->>'reference') r;
    END IF;
  EXCEPTION
    -- Expected business rejections roll back all inner wallet/transaction changes and
    -- are recorded as final outcomes. Infrastructure errors escape and roll back everything.
    WHEN raise_exception OR SQLSTATE 'P2002' OR check_violation OR foreign_key_violation OR invalid_text_representation THEN
      v_result := jsonb_build_object('status', 'rejected', 'message', SQLERRM);
  END;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Payment result missing'; END IF;
  UPDATE public.wallet_operations SET result = v_result WHERE operation_id = p_operation_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_wallet_operation(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_wallet_operation(uuid, jsonb) TO authenticated;
