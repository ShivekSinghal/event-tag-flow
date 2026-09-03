-- Pink'd gate flow (organisers' 4 Sep fix list):
--   * Staff on /issue-tag look a booking up by phone / email / order ref, autofill
--     the wallet form from it, and any Pink'd Coins bought online against that
--     ticket are loaded onto the new band automatically.
--   * Guests who are not students can be issued a band ("GUEST" studio).
--
--   staff_lookup_party_order(p_query)              -> JSONB summary of the paid party order (or NULL)
--   credit_prepaid_coins_to_wallet(order, wallet)  -> loads the not-yet-credited prepaid coins onto a wallet
--   event_order_coin_credits                       -> ledger so an order can never be credited twice
--
-- Runs after 20260904100000 (find_paid_party_order / get_prepaid_coins_for_order /
-- event_orders.parent_order_id) and 20260904120000 (event_order_attendees).

-- ---------------------------------------------------------------------------
-- 1. Studio: wallets.studio is free text with DEFAULT 'NDA' and no CHECK
--    constraint or enum (20250902180805), so the new 'GUEST' value needs no
--    schema change. Document the convention.
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.wallets.studio IS
  'Studio code shown on the band (NDA, RG, ED, PP, SD, GGN, IPM, RMG, AV, DWK) or GUEST for attendees who are not students.';

-- ---------------------------------------------------------------------------
-- 2. Ledger of prepaid-coin credits (one row per load onto a band)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_order_coin_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id UUID NOT NULL REFERENCES public.event_orders(id),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  coins INTEGER NOT NULL CHECK (coins > 0),
  credited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_order_coin_credits_parent_order_id_idx
  ON public.event_order_coin_credits (parent_order_id);
CREATE INDEX IF NOT EXISTS event_order_coin_credits_wallet_id_idx
  ON public.event_order_coin_credits (wallet_id);

ALTER TABLE public.event_order_coin_credits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_order_coin_credits FROM anon, authenticated;
GRANT SELECT, INSERT ON public.event_order_coin_credits TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can view coin credits" ON public.event_order_coin_credits;
DROP POLICY IF EXISTS "Authenticated users can record coin credits" ON public.event_order_coin_credits;

CREATE POLICY "Authenticated users can view coin credits"
ON public.event_order_coin_credits
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can record coin credits"
ON public.event_order_coin_credits
FOR INSERT
TO authenticated
WITH CHECK (true);

COMMENT ON TABLE public.event_order_coin_credits IS
  'Pink''d Coins bought online (event_orders with booking_source = coins_page) that have been loaded onto a wristband wallet. SUM(coins) per parent order is compared with get_prepaid_coins_for_order() so nothing is credited twice.';

-- ---------------------------------------------------------------------------
-- 3. Staff lookup: phone / email / order ref -> booking summary
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_lookup_party_order(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
  v_party_entries INTEGER := 0;
  v_items JSONB := '[]'::jsonb;
  v_attendees JSONB := '[]'::jsonb;
  v_prepaid INTEGER := 0;
  v_credited INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF length(trim(coalesce(p_query, ''))) = 0 THEN
    RETURN NULL;
  END IF;

  -- Same matcher /coins and /attendees use: order ref (>= 6 chars), booking email, or phone (last 10 digits).
  v_order := public.find_paid_party_order(p_query, p_query);

  IF v_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)), 0)::INTEGER
  INTO v_party_entries
  FROM public.event_order_items items
  WHERE items.order_id = v_order.id
    AND items.package_category IN ('party', 'package', 'group');

  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'package_name', items.package_name,
          'quantity', items.quantity
        )
        ORDER BY items.created_at, items.id
      ),
      '[]'::jsonb
    )
  INTO v_items
  FROM public.event_order_items items
  WHERE items.order_id = v_order.id;

  v_prepaid := COALESCE(public.get_prepaid_coins_for_order(v_order.id), 0);

  SELECT COALESCE(SUM(credits.coins), 0)::INTEGER
  INTO v_credited
  FROM public.event_order_coin_credits credits
  WHERE credits.parent_order_id = v_order.id;

  -- Per-wristband names collected on /attendees (table created by 20260904120000).
  -- Resolved at runtime so this function is safe even if that migration is absent.
  IF to_regclass('public.event_order_attendees') IS NOT NULL THEN
    EXECUTE $q$
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'position', a.position,
            'attendee_name', a.attendee_name,
            'attendee_phone', a.attendee_phone
          )
          ORDER BY a.position
        ),
        '[]'::jsonb
      )
      FROM public.event_order_attendees a
      WHERE a.order_id = $1
    $q$
    INTO v_attendees
    USING v_order.id;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_ref', upper(left(v_order.id::TEXT, 8)),
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'customer_email', v_order.customer_email,
    'customer_studio', v_order.customer_studio,
    'party_entries', v_party_entries,
    'items', v_items,
    'prepaid_coins', v_prepaid,
    'coins_credited', v_credited,
    'attendees', v_attendees
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_lookup_party_order(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_lookup_party_order(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_lookup_party_order(TEXT) TO authenticated;

COMMENT ON FUNCTION public.staff_lookup_party_order(TEXT) IS
  'Staff-only (/issue-tag): finds a paid party-ticket order by phone, email or order ref and returns the booking summary, prepaid coins and per-wristband attendee names, or NULL.';

-- ---------------------------------------------------------------------------
-- 4. Load prepaid coins onto a wallet (atomic; same accounting as TopUp.tsx)
--    TopUp writes: wallets.coin_balance / wallets.balance = new balance, then a
--    transactions row with type 'coin_purchase', amount = coins, coin_amount = coins,
--    inr_amount = INR paid. Here inr_amount is 0 because the rupees were already
--    collected as an event order, so the donation board does not double count.
-- ---------------------------------------------------------------------------

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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as staff to load prepaid coins';
  END IF;

  IF p_parent_order_id IS NULL OR p_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Order and wallet are required';
  END IF;

  -- Serialise concurrent loads for the same order (two gates scanning at once).
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
  SELECT profiles.id INTO v_staff
  FROM public.profiles
  WHERE profiles.id = auth.uid();

  v_new_balance := COALESCE(v_wallet.coin_balance, 0) + v_remaining;

  INSERT INTO public.event_order_coin_credits (parent_order_id, wallet_id, coins, credited_by)
  VALUES (v_order.id, v_wallet.id, v_remaining, auth.uid())
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
    'Prepaid online · order ' || v_order_ref,
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

REVOKE ALL ON FUNCTION public.credit_prepaid_coins_to_wallet(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_prepaid_coins_to_wallet(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.credit_prepaid_coins_to_wallet(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.credit_prepaid_coins_to_wallet(UUID, UUID) IS
  'Staff-only (/issue-tag): loads the not-yet-credited Pink''d Coins bought online against a paid party ticket onto a wristband wallet. Records event_order_coin_credits + a coin_purchase transaction with inr_amount = 0.';
