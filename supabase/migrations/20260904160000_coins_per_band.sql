-- Crews and multi-entry bookings: once a band exists, the BAND is the identity
-- for coins, not the order.
--   * Each paid /coins order is credited exactly once, to one band, via a
--     per-order ledger row (event_order_coin_credits.coin_order_id).
--   * A coin order can name the band it is for (event_orders.target_wallet_id).
--     The webhook credits that band; with one linked band it credits that one;
--     with several and no choice it leaves the coins for staff to assign.
--   * /coins also resolves a person by the phone they gave at the gate or on
--     the attendee form, straight to their own band.
--   * Staff decide which band receives coins bought before the event.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_order_coin_credits
  ADD COLUMN IF NOT EXISTS coin_order_id UUID REFERENCES public.event_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS event_order_coin_credits_coin_order_id_key
ON public.event_order_coin_credits (coin_order_id)
WHERE coin_order_id IS NOT NULL;

ALTER TABLE public.event_orders
  ADD COLUMN IF NOT EXISTS target_wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.event_orders.target_wallet_id IS 'For /coins orders: the band the buyer chose to load. NULL = decide at credit time (single linked band) or at the counter.';
COMMENT ON COLUMN public.event_order_coin_credits.coin_order_id IS 'The /coins order this credit fulfilled. Unique, so a coin order can never be credited twice.';

-- ---------------------------------------------------------------------------
-- 2. Credit one coin order to one band (idempotent)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_coin_order_amount(p_coin_order_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(packages.coin_amount * items.quantity), 0)::INTEGER
  FROM public.event_order_items items
  JOIN public.coin_packages packages ON packages.id::TEXT = replace(items.package_key, 'coin-package:', '')
  WHERE items.order_id = p_coin_order_id
    AND items.package_category = 'coins';
$$;

REVOKE ALL ON FUNCTION public.get_coin_order_amount(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.credit_coin_order_to_wallet(
  p_coin_order_id UUID,
  p_wallet_id UUID,
  p_actor UUID,
  p_description_prefix TEXT DEFAULT 'Topped up online'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_coin_order public.event_orders;
  v_wallet public.wallets;
  v_coins INTEGER;
  v_new_balance INTEGER;
  v_staff UUID;
  v_credit_id UUID;
  v_ref TEXT;
BEGIN
  SELECT * INTO v_coin_order FROM public.event_orders WHERE id = p_coin_order_id FOR UPDATE;

  IF v_coin_order.id IS NULL OR v_coin_order.booking_source <> 'coins_page' OR v_coin_order.parent_order_id IS NULL THEN
    RAISE EXCEPTION 'Not a Pink''d Coins order';
  END IF;

  IF NOT public.event_order_is_paid(v_coin_order.payment_status) THEN
    RETURN jsonb_build_object('credited', 0, 'reason', 'not_paid');
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_order_coin_credits WHERE coin_order_id = v_coin_order.id) THEN
    RETURN jsonb_build_object('credited', 0, 'reason', 'already_credited');
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Wallet is %', v_wallet.status;
  END IF;

  IF v_wallet.event_order_id IS DISTINCT FROM v_coin_order.parent_order_id THEN
    RAISE EXCEPTION 'This band belongs to a different booking';
  END IF;

  v_coins := public.get_coin_order_amount(v_coin_order.id);
  IF v_coins <= 0 THEN
    RETURN jsonb_build_object('credited', 0, 'reason', 'empty_order');
  END IF;

  IF p_actor IS NOT NULL THEN
    SELECT profiles.id INTO v_staff FROM public.profiles WHERE profiles.id = p_actor;
  END IF;

  v_ref := upper(left(v_coin_order.id::TEXT, 8));
  v_new_balance := COALESCE(v_wallet.coin_balance, 0) + v_coins;

  INSERT INTO public.event_order_coin_credits (parent_order_id, coin_order_id, wallet_id, coins, credited_by)
  VALUES (v_coin_order.parent_order_id, v_coin_order.id, v_wallet.id, v_coins, p_actor)
  RETURNING id INTO v_credit_id;

  UPDATE public.wallets
  SET coin_balance = v_new_balance, balance = v_new_balance
  WHERE id = v_wallet.id;

  INSERT INTO public.transactions (wallet_id, type, amount, inr_amount, coin_amount, description, reference, staff_user_id)
  VALUES (v_wallet.id, 'coin_purchase', v_coins, 0, v_coins,
          coalesce(p_description_prefix, 'Topped up online') || ' · order ' || v_ref, 'coins:' || v_ref, v_staff);

  RETURN jsonb_build_object('credited', v_coins, 'reason', 'credited', 'new_balance', v_new_balance, 'credit_id', v_credit_id, 'coin_order_ref', v_ref);
END;
$$;

REVOKE ALL ON FUNCTION public.credit_coin_order_to_wallet(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gate: load everything unassigned onto this band (same contract as before)
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
  v_coin_order RECORD;
  v_result JSONB;
  v_credited_now INTEGER := 0;
  v_prepaid INTEGER := 0;
  v_credited INTEGER := 0;
BEGIN
  SELECT * INTO v_order FROM public.event_orders WHERE id = p_parent_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.booking_source <> 'landing_page' OR NOT public.event_order_is_paid(v_order.payment_status) THEN
    RAISE EXCEPTION 'Order % is not a paid party ticket', upper(left(v_order.id::TEXT, 8));
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;
  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;

  FOR v_coin_order IN
    SELECT coin_orders.id
    FROM public.event_orders coin_orders
    WHERE coin_orders.parent_order_id = v_order.id
      AND coin_orders.booking_source = 'coins_page'
      AND public.event_order_is_paid(coin_orders.payment_status)
      AND (coin_orders.target_wallet_id IS NULL OR coin_orders.target_wallet_id = p_wallet_id)
      AND NOT EXISTS (SELECT 1 FROM public.event_order_coin_credits c WHERE c.coin_order_id = coin_orders.id)
    ORDER BY coin_orders.created_at
  LOOP
    v_result := public.credit_coin_order_to_wallet(v_coin_order.id, p_wallet_id, p_actor, p_description_prefix);
    v_credited_now := v_credited_now + COALESCE((v_result ->> 'credited')::INTEGER, 0);
  END LOOP;

  v_prepaid := COALESCE(public.get_prepaid_coins_for_order(v_order.id), 0);
  SELECT COALESCE(SUM(coins), 0)::INTEGER INTO v_credited FROM public.event_order_coin_credits WHERE parent_order_id = v_order.id;
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;

  RETURN jsonb_build_object(
    'credited', v_credited_now,
    'prepaid_coins', v_prepaid,
    'coins_credited', v_credited,
    'new_balance', COALESCE(v_wallet.coin_balance, 0),
    'order_ref', upper(left(v_order.id::TEXT, 8))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_prepaid_coin_credit(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.link_wallet_to_event_order(UUID, UUID);

CREATE OR REPLACE FUNCTION public.link_wallet_to_event_order(
  p_wallet_id UUID,
  p_parent_order_id UUID,
  p_load_prepaid BOOLEAN DEFAULT true
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

  UPDATE public.wallets SET event_order_id = v_order.id WHERE id = v_wallet.id;

  IF p_load_prepaid THEN
    v_result := public.apply_prepaid_coin_credit(v_order.id, v_wallet.id, auth.uid(), 'Prepaid online');
  ELSE
    v_result := jsonb_build_object(
      'credited', 0,
      'prepaid_coins', COALESCE(public.get_prepaid_coins_for_order(v_order.id), 0),
      'coins_credited', (SELECT COALESCE(SUM(coins), 0) FROM public.event_order_coin_credits WHERE parent_order_id = v_order.id),
      'new_balance', COALESCE(v_wallet.coin_balance, 0),
      'order_ref', upper(left(v_order.id::TEXT, 8))
    );
  END IF;

  RETURN v_result || jsonb_build_object('linked', true, 'wallet_id', v_wallet.id);
END;
$$;

REVOKE ALL ON FUNCTION public.link_wallet_to_event_order(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_wallet_to_event_order(UUID, UUID, BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Webhook: credit the chosen band, or the only band, else leave for staff
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
  v_wallet_id UUID;
  v_band_count INTEGER;
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

  IF v_coin_order.target_wallet_id IS NOT NULL THEN
    SELECT id INTO v_wallet_id FROM public.wallets
    WHERE id = v_coin_order.target_wallet_id AND status = 'active' AND event_order_id = v_coin_order.parent_order_id;
  END IF;

  IF v_wallet_id IS NULL THEN
    SELECT count(*) INTO v_band_count FROM public.wallets
    WHERE event_order_id = v_coin_order.parent_order_id AND status = 'active';

    IF v_band_count = 0 THEN
      RETURN jsonb_build_object('credited', 0, 'reason', 'no_wallet_yet');
    ELSIF v_band_count > 1 THEN
      RETURN jsonb_build_object('credited', 0, 'reason', 'choose_band');
    END IF;

    SELECT id INTO v_wallet_id FROM public.wallets
    WHERE event_order_id = v_coin_order.parent_order_id AND status = 'active';
  END IF;

  RETURN public.credit_coin_order_to_wallet(v_coin_order.id, v_wallet_id, NULL, 'Topped up online')
    || jsonb_build_object('wallet_id', v_wallet_id);
END;
$$;

REVOKE ALL ON FUNCTION public.auto_credit_coin_order(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_credit_coin_order(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. /coins: resolve a person to their own band; list the bands on the order
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
  v_phone TEXT := public.normalize_phone_digits(p_contact);
  v_matched_wallet UUID;
  v_party_entries INTEGER;
  v_coins_purchased INTEGER;
  v_coins_pending INTEGER;
  v_coins_credited INTEGER;
  v_coins_waiting INTEGER;
  v_bands JSONB;
  v_band_count INTEGER;
  v_balance INTEGER := 0;
  v_hint TEXT;
BEGIN
  v_order := public.find_paid_party_order(p_order_ref, p_contact);

  -- Not the booker? Try the phone given at the gate, then the attendee form.
  IF v_order.id IS NULL AND length(v_phone) = 10 THEN
    SELECT orders.*, wallets.id
    INTO v_order, v_matched_wallet
    FROM public.wallets
    JOIN public.event_orders orders ON orders.id = wallets.event_order_id
    WHERE wallets.status = 'active'
      AND public.normalize_phone_digits(wallets.attendee_phone) = v_phone
      AND public.event_order_is_paid(orders.payment_status)
    ORDER BY wallets.created_at DESC
    LIMIT 1;

    IF v_order.id IS NULL THEN
      SELECT orders.* INTO v_order
      FROM public.event_order_attendees attendees
      JOIN public.event_orders orders ON orders.id = attendees.order_id
      WHERE public.normalize_phone_digits(attendees.attendee_phone) = v_phone
        AND public.event_order_is_paid(orders.payment_status)
      ORDER BY attendees.created_at DESC
      LIMIT 1;
    END IF;
  END IF;

  IF v_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Booker typed their own phone: match their band by that phone too.
  IF v_matched_wallet IS NULL AND length(v_phone) = 10 THEN
    SELECT id INTO v_matched_wallet FROM public.wallets
    WHERE event_order_id = v_order.id AND status = 'active'
      AND public.normalize_phone_digits(attendee_phone) = v_phone
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  SELECT COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)), 0)::INTEGER
  INTO v_party_entries
  FROM public.event_order_items items
  WHERE items.order_id = v_order.id AND items.package_category IN ('party', 'package', 'group');

  SELECT
    COALESCE(SUM(packages.coin_amount * items.quantity) FILTER (WHERE public.event_order_is_paid(coin_orders.payment_status)), 0)::INTEGER,
    COALESCE(SUM(packages.coin_amount * items.quantity) FILTER (WHERE public.event_order_hold_is_live(coin_orders.payment_status, coin_orders.checkout_token_expires_at, coin_orders.created_at)), 0)::INTEGER
  INTO v_coins_purchased, v_coins_pending
  FROM public.event_orders coin_orders
  JOIN public.event_order_items items ON items.order_id = coin_orders.id AND items.package_category = 'coins'
  LEFT JOIN public.coin_packages packages ON packages.id::TEXT = replace(items.package_key, 'coin-package:', '')
  WHERE coin_orders.parent_order_id = v_order.id;

  SELECT COALESCE(SUM(coins), 0)::INTEGER INTO v_coins_credited
  FROM public.event_order_coin_credits WHERE parent_order_id = v_order.id;

  SELECT COALESCE(SUM(public.get_coin_order_amount(coin_orders.id)), 0)::INTEGER
  INTO v_coins_waiting
  FROM public.event_orders coin_orders
  WHERE coin_orders.parent_order_id = v_order.id
    AND coin_orders.booking_source = 'coins_page'
    AND public.event_order_is_paid(coin_orders.payment_status)
    AND NOT EXISTS (SELECT 1 FROM public.event_order_coin_credits c WHERE c.coin_order_id = coin_orders.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'wallet_id', w.id,
           'name', split_part(trim(w.attendee_name), ' ', 1),
           'band_hint', right(w.tag_id, 3),
           'coin_balance', COALESCE(w.coin_balance, 0)
         ) ORDER BY w.created_at), '[]'::jsonb), count(*)
  INTO v_bands, v_band_count
  FROM public.wallets w
  WHERE w.event_order_id = v_order.id AND w.status = 'active';

  IF v_matched_wallet IS NULL AND v_band_count = 1 THEN
    SELECT id INTO v_matched_wallet FROM public.wallets WHERE event_order_id = v_order.id AND status = 'active';
  END IF;

  IF v_matched_wallet IS NOT NULL THEN
    SELECT COALESCE(coin_balance, 0), right(tag_id, 3) INTO v_balance, v_hint FROM public.wallets WHERE id = v_matched_wallet;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_ref', upper(left(v_order.id::TEXT, 8)),
    'first_name', split_part(trim(v_order.customer_name), ' ', 1),
    'party_entries', v_party_entries,
    'coins_purchased', v_coins_purchased,
    'coins_pending', v_coins_pending,
    'coins_credited', v_coins_credited,
    'coins_waiting', v_coins_waiting,
    'wallet_linked', v_band_count > 0,
    'band_count', v_band_count,
    'bands', v_bands,
    'matched_wallet_id', v_matched_wallet,
    'coin_balance', v_balance,
    'band_hint', v_hint,
    'paid_at', v_order.paid_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_party_order(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_party_order(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. /coins checkout: accept an attendee's phone as proof, record the band
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_coin_order_checkout(UUID, TEXT, JSONB, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.create_coin_order_checkout(
  p_parent_order_id UUID,
  p_proof TEXT,
  p_cart_items JSONB,
  p_checkout_token_hash TEXT,
  p_attribution JSONB DEFAULT '{}'::jsonb,
  p_target_wallet_id UUID DEFAULT NULL
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent public.event_orders;
  v_proof TEXT := lower(trim(coalesce(p_proof, '')));
  v_phone TEXT := public.normalize_phone_digits(p_proof);
  v_proof_ok BOOLEAN := false;
  v_order_id UUID;
  v_total NUMERIC(10,2) := 0;
  v_item JSONB;
  v_quantity INTEGER;
  v_coin_package_id_text TEXT;
  v_coin_package public.coin_packages%ROWTYPE;
  v_line_total NUMERIC(10,2);
BEGIN
  IF lower(trim(coalesce(p_checkout_token_hash, ''))) !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Valid checkout token hash is required';
  END IF;
  IF p_attribution IS NOT NULL AND jsonb_typeof(p_attribution) <> 'object' THEN
    RAISE EXCEPTION 'Attribution must be a JSON object';
  END IF;
  IF jsonb_typeof(p_cart_items) <> 'array' OR jsonb_array_length(p_cart_items) = 0 THEN
    RAISE EXCEPTION 'Pick at least one coin pack';
  END IF;
  IF jsonb_array_length(p_cart_items) > 10 THEN
    RAISE EXCEPTION 'Too many coin packs in one order';
  END IF;

  SELECT * INTO v_parent FROM public.event_orders WHERE id = p_parent_order_id;
  IF v_parent.id IS NULL OR NOT public.event_order_is_paid(v_parent.payment_status) OR v_parent.booking_source <> 'landing_page' THEN
    RAISE EXCEPTION 'Pink''d Coins can only be bought against a paid party ticket';
  END IF;

  -- Proof: order ref, booking email/phone, a linked band's phone, or an attendee-form phone.
  v_proof_ok :=
    upper(v_proof) = upper(left(v_parent.id::TEXT, 8))
    OR v_proof = lower(v_parent.customer_email)
    OR (length(v_phone) = 10 AND v_phone = public.normalize_phone_digits(v_parent.customer_phone))
    OR (length(v_phone) = 10 AND EXISTS (
          SELECT 1 FROM public.wallets w
          WHERE w.event_order_id = v_parent.id AND public.normalize_phone_digits(w.attendee_phone) = v_phone))
    OR (length(v_phone) = 10 AND EXISTS (
          SELECT 1 FROM public.event_order_attendees a
          WHERE a.order_id = v_parent.id AND public.normalize_phone_digits(a.attendee_phone) = v_phone));

  IF NOT v_proof_ok THEN
    RAISE EXCEPTION 'We could not match that order reference, email or phone to a paid party ticket';
  END IF;

  IF p_target_wallet_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.wallets w WHERE w.id = p_target_wallet_id AND w.event_order_id = v_parent.id AND w.status = 'active'
  ) THEN
    RAISE EXCEPTION 'That band is not part of this booking';
  END IF;

  INSERT INTO public.event_orders (
    customer_name, customer_phone, customer_email, customer_studio, total_amount_inr, payment_status,
    booking_source, parent_order_id, target_wallet_id, checkout_token_hash, checkout_token_expires_at, attribution
  )
  VALUES (
    v_parent.customer_name, v_parent.customer_phone, v_parent.customer_email, v_parent.customer_studio, 0, 'manual_payment',
    'coins_page', v_parent.id, p_target_wallet_id, lower(trim(p_checkout_token_hash)), now() + interval '15 minutes', coalesce(p_attribution, '{}'::jsonb)
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items)
  LOOP
    v_quantity := NULLIF(v_item ->> 'quantity', '')::INTEGER;
    v_coin_package_id_text := NULLIF(v_item ->> 'coin_package_id', '');
    IF v_coin_package_id_text IS NULL AND (v_item ->> 'package_key') LIKE 'coin-package:%' THEN
      v_coin_package_id_text := replace(v_item ->> 'package_key', 'coin-package:', '');
    END IF;
    IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 20 THEN
      RAISE EXCEPTION 'Invalid coin pack quantity';
    END IF;
    IF v_coin_package_id_text IS NULL
      OR v_coin_package_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid Pink''d Coin pack';
    END IF;

    SELECT * INTO v_coin_package FROM public.coin_packages WHERE id = v_coin_package_id_text::UUID AND active = true;
    IF v_coin_package.id IS NULL THEN
      RAISE EXCEPTION 'This Pink''d Coin pack is unavailable';
    END IF;

    v_line_total := v_coin_package.inr_amount * v_quantity;
    v_total := v_total + v_line_total;

    INSERT INTO public.event_order_items (order_id, package_key, package_category, package_name, unit_price_inr, quantity, pax, line_total_inr, selected_time_slots)
    VALUES (v_order_id, 'coin-package:' || v_coin_package.id::TEXT, 'coins', v_coin_package.coin_amount::TEXT || ' Pink''d Coins',
            v_coin_package.inr_amount, v_quantity, NULL, v_line_total, '[]'::jsonb);
  END LOOP;

  UPDATE public.event_orders SET total_amount_inr = v_total WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.create_coin_order_checkout(UUID, TEXT, JSONB, TEXT, JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_coin_order_checkout(UUID, TEXT, JSONB, TEXT, JSONB, UUID) TO anon, authenticated;
