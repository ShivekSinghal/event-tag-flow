-- Self-service top-up for ticket holders (decided with Shivek, 4 Sep 2026 05:00):
--   * Attendees never tap anything to top up. They open /coins from their
--     confirmation email, verify with their order ref / booking email / phone,
--     pay through Cashfree, and the coins land on their band automatically.
--   * The band is linked to the booking when staff issue it at the gate.
--   * Coins bought before the band exists stay "prepaid" and load at issue time;
--     coins bought after the band exists credit the wallet the moment the
--     gateway confirms payment. Both paths share one idempotent ledger
--     (event_order_coin_credits), so nothing can be credited twice.
--   * Money can only ever be added online; spending still needs the physical
--     band at a staff POS.

-- ---------------------------------------------------------------------------
-- 1. Band ↔ booking link
-- ---------------------------------------------------------------------------

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS event_order_id UUID REFERENCES public.event_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wallets_event_order_id_idx
ON public.wallets (event_order_id)
WHERE event_order_id IS NOT NULL;

COMMENT ON COLUMN public.wallets.event_order_id IS 'The paid party-ticket order this band was issued against. Online coin top-ups for that order credit this wallet automatically.';

-- ---------------------------------------------------------------------------
-- 2. One credit routine, used by the gate (staff) and by the payment webhook
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_prepaid_coin_credit(
  p_parent_order_id UUID,
  p_wallet_id UUID,
  p_actor UUID,
  p_description_prefix TEXT DEFAULT 'Prepaid online'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
  v_wallet public.wallets;
  v_prepaid INTEGER := 0;
  v_credited INTEGER := 0;
  v_remaining INTEGER := 0;
  v_new_balance INTEGER := 0;
  v_order_ref TEXT;
  v_staff UUID;
  v_credit_id UUID;
BEGIN
  IF p_parent_order_id IS NULL OR p_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Order and wallet are required';
  END IF;

  -- Serialise concurrent loads for the same order (gate scan + webhook at once).
  SELECT * INTO v_order
  FROM public.event_orders
  WHERE id = p_parent_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.booking_source <> 'landing_page' OR NOT public.event_order_is_paid(v_order.payment_status) THEN
    RAISE EXCEPTION 'Order % is not a paid party ticket', upper(left(v_order.id::TEXT, 8));
  END IF;

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

  v_prepaid := COALESCE(public.get_prepaid_coins_for_order(v_order.id), 0);

  SELECT COALESCE(SUM(credits.coins), 0)::INTEGER
  INTO v_credited
  FROM public.event_order_coin_credits credits
  WHERE credits.parent_order_id = v_order.id;

  v_remaining := GREATEST(0, v_prepaid - v_credited);
  v_order_ref := upper(left(v_order.id::TEXT, 8));

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object(
      'credited', 0,
      'prepaid_coins', v_prepaid,
      'coins_credited', v_credited,
      'new_balance', COALESCE(v_wallet.coin_balance, 0),
      'order_ref', v_order_ref
    );
  END IF;

  -- transactions.staff_user_id references profiles(id); only set it when a profile exists.
  IF p_actor IS NOT NULL THEN
    SELECT profiles.id INTO v_staff
    FROM public.profiles
    WHERE profiles.id = p_actor;
  END IF;

  v_new_balance := COALESCE(v_wallet.coin_balance, 0) + v_remaining;

  INSERT INTO public.event_order_coin_credits (parent_order_id, wallet_id, coins, credited_by)
  VALUES (v_order.id, v_wallet.id, v_remaining, p_actor)
  RETURNING id INTO v_credit_id;

  UPDATE public.wallets
  SET coin_balance = v_new_balance,
      balance = v_new_balance
  WHERE id = v_wallet.id;

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
    v_remaining,
    0,
    v_remaining,
    coalesce(p_description_prefix, 'Prepaid online') || ' · order ' || v_order_ref,
    'prepaid:' || v_order_ref,
    v_staff
  );

  RETURN jsonb_build_object(
    'credited', v_remaining,
    'prepaid_coins', v_prepaid,
    'coins_credited', v_credited + v_remaining,
    'new_balance', v_new_balance,
    'order_ref', v_order_ref,
    'credit_id', v_credit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_prepaid_coin_credit(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- Staff entry point keeps its contract; it now delegates to the shared routine.
CREATE OR REPLACE FUNCTION public.credit_prepaid_coins_to_wallet(
  p_parent_order_id UUID,
  p_wallet_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as staff to load prepaid coins';
  END IF;

  RETURN public.apply_prepaid_coin_credit(p_parent_order_id, p_wallet_id, auth.uid(), 'Prepaid online');
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Gate: link the band to the booking, then load anything already paid for
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.link_wallet_to_event_order(
  p_wallet_id UUID,
  p_parent_order_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
  v_wallet public.wallets;
  v_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as staff to link a band';
  END IF;

  SELECT * INTO v_order FROM public.event_orders WHERE id = p_parent_order_id;
  IF v_order.id IS NULL OR v_order.booking_source <> 'landing_page' OR NOT public.event_order_is_paid(v_order.payment_status) THEN
    RAISE EXCEPTION 'Order is not a paid party ticket';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_wallet.event_order_id IS NOT NULL AND v_wallet.event_order_id <> v_order.id THEN
    RAISE EXCEPTION 'This band is already linked to order %', upper(left(v_wallet.event_order_id::TEXT, 8));
  END IF;

  UPDATE public.wallets
  SET event_order_id = v_order.id
  WHERE id = v_wallet.id;

  v_result := public.apply_prepaid_coin_credit(v_order.id, v_wallet.id, auth.uid(), 'Prepaid online');

  RETURN v_result || jsonb_build_object('linked', true, 'wallet_id', v_wallet.id);
END;
$$;

REVOKE ALL ON FUNCTION public.link_wallet_to_event_order(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_wallet_to_event_order(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.link_wallet_to_event_order(UUID, UUID) IS 'Issue Tag: ties a freshly issued band to the paid party-ticket order and loads any coins already bought online. Later online top-ups then credit the band automatically.';

-- ---------------------------------------------------------------------------
-- 4. Webhook: a paid coin order credits the linked band immediately
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_credit_coin_order(p_coin_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_coin_order public.event_orders;
  v_wallet public.wallets;
  v_result JSONB;
BEGIN
  SELECT * INTO v_coin_order FROM public.event_orders WHERE id = p_coin_order_id;

  IF v_coin_order.id IS NULL THEN
    RETURN jsonb_build_object('credited', 0, 'reason', 'order_not_found');
  END IF;

  IF v_coin_order.booking_source <> 'coins_page' OR v_coin_order.parent_order_id IS NULL THEN
    RETURN jsonb_build_object('credited', 0, 'reason', 'not_a_coin_order');
  END IF;

  IF NOT public.event_order_is_paid(v_coin_order.payment_status) THEN
    RETURN jsonb_build_object('credited', 0, 'reason', 'not_paid');
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE event_order_id = v_coin_order.parent_order_id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_wallet.id IS NULL THEN
    -- Band not issued yet: stays prepaid, loads at the gate.
    RETURN jsonb_build_object('credited', 0, 'reason', 'no_wallet_yet');
  END IF;

  v_result := public.apply_prepaid_coin_credit(v_coin_order.parent_order_id, v_wallet.id, NULL, 'Topped up online');
  RETURN v_result || jsonb_build_object('reason', 'credited', 'wallet_id', v_wallet.id);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_credit_coin_order(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_credit_coin_order(UUID) TO service_role;

COMMENT ON FUNCTION public.auto_credit_coin_order(UUID) IS 'Called by the payment webhook/verify edge functions (service role) after a /coins order is paid. Credits the linked band, or leaves the coins prepaid when no band exists yet.';

-- ---------------------------------------------------------------------------
-- 5. /coins lookup also reports the band and its balance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lookup_party_order(p_order_ref TEXT, p_contact TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
  v_wallet public.wallets;
  v_party_entries INTEGER;
  v_coins_purchased INTEGER;
  v_coins_pending INTEGER;
  v_coins_credited INTEGER;
BEGIN
  v_order := public.find_paid_party_order(p_order_ref, p_contact);

  IF v_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)), 0)::INTEGER
  INTO v_party_entries
  FROM public.event_order_items items
  WHERE items.order_id = v_order.id
    AND items.package_category IN ('party', 'package', 'group');

  SELECT
    COALESCE(SUM(packages.coin_amount * items.quantity) FILTER (WHERE public.event_order_is_paid(coin_orders.payment_status)), 0)::INTEGER,
    COALESCE(SUM(packages.coin_amount * items.quantity) FILTER (WHERE public.event_order_hold_is_live(coin_orders.payment_status, coin_orders.checkout_token_expires_at, coin_orders.created_at)), 0)::INTEGER
  INTO v_coins_purchased, v_coins_pending
  FROM public.event_orders coin_orders
  JOIN public.event_order_items items ON items.order_id = coin_orders.id AND items.package_category = 'coins'
  LEFT JOIN public.coin_packages packages ON packages.id::TEXT = replace(items.package_key, 'coin-package:', '')
  WHERE coin_orders.parent_order_id = v_order.id;

  SELECT COALESCE(SUM(credits.coins), 0)::INTEGER
  INTO v_coins_credited
  FROM public.event_order_coin_credits credits
  WHERE credits.parent_order_id = v_order.id;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE event_order_id = v_order.id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_ref', upper(left(v_order.id::TEXT, 8)),
    'first_name', split_part(trim(v_order.customer_name), ' ', 1),
    'party_entries', v_party_entries,
    'coins_purchased', v_coins_purchased,
    'coins_pending', v_coins_pending,
    'coins_credited', v_coins_credited,
    'coins_waiting', GREATEST(v_coins_purchased - v_coins_credited, 0),
    'wallet_linked', v_wallet.id IS NOT NULL,
    'coin_balance', COALESCE(v_wallet.coin_balance, 0),
    'band_hint', CASE WHEN v_wallet.id IS NULL THEN NULL ELSE right(v_wallet.tag_id, 3) END,
    'paid_at', v_order.paid_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_party_order(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_party_order(TEXT, TEXT) TO anon, authenticated;
