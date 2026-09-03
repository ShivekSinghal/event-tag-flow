-- Pink'd 2026 booking model (per Manas's review emails of 3 Sep):
--   1. Party phases are computed by the server from live bookings, never set by hand.
--      party_count = paid party entries + entries inside a live 15-minute hold.
--      0–49 → Phase 1 ₹2,000 · 50–149 → Phase 2 ₹2,499 · 150+ → Phase 3 ₹2,999.
--      The phase ratchets forward only. Full Pass / Crew prices are flat.
--   2. Intensives are capped at 120 seats per session; 4-intensive, full and crew
--      passes count against all four sessions (crews at pax count).
--   3. Pink'd Coins leave the landing-page cart. They are sold on /coins only to
--      buyers who already hold a paid party ticket, and linked to that order.
--   4. get_event_party_status() feeds GET /api/party-status and the checkout from
--      one query, so the price shown always matches the price charged.
--   5. Abandoned checkouts expire automatically after the hold.

-- ---------------------------------------------------------------------------
-- 1. Phase catalogue keyed by party-entry count (read-only for admins)
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_pricing_phases DROP CONSTRAINT IF EXISTS event_pricing_phases_phase_key_check;

ALTER TABLE public.event_pricing_phases
  ADD COLUMN IF NOT EXISTS phase_number INTEGER,
  ADD COLUMN IF NOT EXISTS min_party_count INTEGER,
  ADD COLUMN IF NOT EXISTS party_price_inr NUMERIC(10,2);

DELETE FROM public.event_pricing_phases WHERE phase_key IN ('early_bird', 'last_call');

INSERT INTO public.event_pricing_phases (phase_key, name, active, starts_at, ends_at, display_order, phase_number, min_party_count, party_price_inr)
VALUES
  ('phase_1', 'Phase 1', true, NULL, NULL, 10, 1, 0, 2000),
  ('phase_2', 'Phase 2', true, NULL, NULL, 20, 2, 50, 2499),
  ('phase_3', 'Phase 3', true, NULL, NULL, 30, 3, 150, 2999)
ON CONFLICT (phase_key) DO UPDATE
SET
  name = EXCLUDED.name,
  active = true,
  starts_at = NULL,
  ends_at = NULL,
  display_order = EXCLUDED.display_order,
  phase_number = EXCLUDED.phase_number,
  min_party_count = EXCLUDED.min_party_count,
  party_price_inr = EXCLUDED.party_price_inr,
  updated_at = now();

ALTER TABLE public.event_pricing_phases
  ADD CONSTRAINT event_pricing_phases_phase_key_check CHECK (phase_key IN ('phase_1', 'phase_2', 'phase_3'));

ALTER TABLE public.event_pricing_phases
  ALTER COLUMN phase_number SET NOT NULL,
  ALTER COLUMN min_party_count SET NOT NULL,
  ALTER COLUMN party_price_inr SET NOT NULL;

ALTER TABLE public.event_pricing_phases DROP CONSTRAINT IF EXISTS event_pricing_phases_phase_number_unique;
ALTER TABLE public.event_pricing_phases ADD CONSTRAINT event_pricing_phases_phase_number_unique UNIQUE (phase_number);

-- Nobody edits phases by hand any more: the dashboard becomes read-only.
DROP POLICY IF EXISTS "Admins can update event pricing phases" ON public.event_pricing_phases;
DROP POLICY IF EXISTS "Admins can update event package phase limits" ON public.event_package_phase_limits;
REVOKE UPDATE ON public.event_pricing_phases FROM authenticated;
REVOKE UPDATE ON public.event_package_phase_limits FROM authenticated;

COMMENT ON TABLE public.event_pricing_phases IS 'Pink''d party-entry phases. The live phase is computed from paid + held party entries (see get_event_party_status); it is never set by hand.';
COMMENT ON COLUMN public.event_pricing_phases.min_party_count IS 'The phase applies once paid + held party entries reach this count.';
COMMENT ON COLUMN public.event_pricing_phases.party_price_inr IS 'Party-only entry price during this phase. Bundles are flat and ignore phases.';
COMMENT ON TABLE public.event_package_phase_limits IS 'DEPRECATED (4 Sep 2026): per-phase package capacities are no longer used. Party phases come from the live count; intensives use event_sessions.seat_cap.';

-- ---------------------------------------------------------------------------
-- 2. Ratchet state: the highest phase ever reached never rolls back
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_party_phase_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  highest_phase_number INTEGER NOT NULL DEFAULT 1,
  highest_party_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.event_party_phase_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.event_party_phase_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_party_phase_state FROM anon, authenticated;
GRANT SELECT ON public.event_party_phase_state TO authenticated;

DROP POLICY IF EXISTS "Admins can view party phase state" ON public.event_party_phase_state;
CREATE POLICY "Admins can view party phase state"
ON public.event_party_phase_state
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 3. Intensive sessions and their hard seat caps
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_sessions (
  session_number INTEGER PRIMARY KEY CHECK (session_number BETWEEN 1 AND 4),
  slot_label TEXT NOT NULL UNIQUE,
  seat_cap INTEGER NOT NULL DEFAULT 120 CHECK (seat_cap >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.event_sessions (session_number, slot_label, seat_cap)
VALUES
  (1, 'Wednesday, Sept 9 @ 6:00 PM', 120),
  (2, 'Wednesday, Sept 9 @ 8:00 PM', 120),
  (3, 'Thursday, Sept 10 @ 6:00 PM', 120),
  (4, 'Thursday, Sept 10 @ 8:00 PM', 120)
ON CONFLICT (session_number) DO UPDATE
SET slot_label = EXCLUDED.slot_label, updated_at = now();

ALTER TABLE public.event_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_sessions FROM anon, authenticated;
GRANT SELECT ON public.event_sessions TO anon, authenticated;

DROP POLICY IF EXISTS "Public can view event sessions" ON public.event_sessions;
CREATE POLICY "Public can view event sessions"
ON public.event_sessions
FOR SELECT
TO anon, authenticated
USING (true);

COMMENT ON TABLE public.event_sessions IS 'The four Pink''d intensive sessions and their hard seat caps (120). Labels must match event_order_items.selected_time_slots.';

-- ---------------------------------------------------------------------------
-- 4. Coin orders link to the party ticket they belong to
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_orders
  ADD COLUMN IF NOT EXISTS parent_order_id UUID REFERENCES public.event_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS event_orders_parent_order_id_idx
ON public.event_orders (parent_order_id)
WHERE parent_order_id IS NOT NULL;

COMMENT ON COLUMN public.event_orders.parent_order_id IS 'For Pink''d Coin orders bought on /coins: the paid party-ticket order the coins are credited against.';

-- Brand spelling is Pink'd. Fix historic coin line items.
UPDATE public.event_order_items
SET package_name = replace(package_name, 'Pink''D', 'Pink''d')
WHERE package_category = 'coins' AND package_name LIKE '%Pink''D%';

-- Confirmed coin ladder: ₹2,000 → 2,000 · ₹5,000 → 6,000 · ₹10,000 → 14,000 · ₹20,000 → 30,000.
UPDATE public.coin_packages SET coin_amount = 14000, updated_at = now() WHERE inr_amount = 10000 AND coin_amount <> 14000;
UPDATE public.coin_packages SET active = false, updated_at = now() WHERE inr_amount = 15000;
UPDATE public.coin_packages SET coin_amount = 2000, updated_at = now() WHERE inr_amount = 2000 AND coin_amount <> 2000;
UPDATE public.coin_packages SET coin_amount = 6000, updated_at = now() WHERE inr_amount = 5000 AND coin_amount <> 6000;
UPDATE public.coin_packages SET coin_amount = 30000, updated_at = now() WHERE inr_amount = 20000 AND coin_amount <> 30000;

-- ---------------------------------------------------------------------------
-- 5. Counting helpers (one rule for the meter, the phase and the checkout)
-- ---------------------------------------------------------------------------

-- An order counts while it is paid, or while its 15-minute checkout hold is live.
CREATE OR REPLACE FUNCTION public.event_order_is_paid(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN ('paid', 'completed');
$$;

CREATE OR REPLACE FUNCTION public.event_order_hold_is_live(p_status TEXT, p_expires_at TIMESTAMPTZ, p_created_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT p_status IN ('pending', 'manual_payment')
    AND COALESCE(p_expires_at, p_created_at + interval '15 minutes') > now();
$$;

-- Party entries: party-only tickets at quantity, full passes as 1, crews at pax.
CREATE OR REPLACE FUNCTION public.get_party_entry_counts()
RETURNS TABLE(booked INTEGER, held INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)) FILTER (WHERE public.event_order_is_paid(orders.payment_status)), 0)::INTEGER AS booked,
    COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)) FILTER (WHERE public.event_order_hold_is_live(orders.payment_status, orders.checkout_token_expires_at, orders.created_at)), 0)::INTEGER AS held
  FROM public.event_order_items items
  JOIN public.event_orders orders ON orders.id = items.order_id
  WHERE items.package_category IN ('party', 'package', 'group');
$$;

-- Seats per session: any item whose selected_time_slots contains the slot label.
CREATE OR REPLACE FUNCTION public.get_session_seat_counts()
RETURNS TABLE(session_number INTEGER, slot_label TEXT, seat_cap INTEGER, booked INTEGER, held INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    sessions.session_number,
    sessions.slot_label,
    sessions.seat_cap,
    COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)) FILTER (WHERE public.event_order_is_paid(orders.payment_status)), 0)::INTEGER AS booked,
    COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)) FILTER (WHERE public.event_order_hold_is_live(orders.payment_status, orders.checkout_token_expires_at, orders.created_at)), 0)::INTEGER AS held
  FROM public.event_sessions sessions
  LEFT JOIN public.event_order_items items
    ON jsonb_typeof(items.selected_time_slots) = 'array'
   AND items.selected_time_slots ? sessions.slot_label
  LEFT JOIN public.event_orders orders ON orders.id = items.order_id
  GROUP BY sessions.session_number, sessions.slot_label, sessions.seat_cap
  ORDER BY sessions.session_number;
$$;

CREATE OR REPLACE FUNCTION public.get_party_phase_for_count(p_count INTEGER)
RETURNS public.event_pricing_phases
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT phases.*
  FROM public.event_pricing_phases phases
  WHERE phases.active = true
    AND phases.min_party_count <= GREATEST(COALESCE(p_count, 0), 0)
  ORDER BY phases.min_party_count DESC
  LIMIT 1;
$$;

-- Resolve the live phase and advance the ratchet. p_lock serialises checkouts.
CREATE OR REPLACE FUNCTION public.resolve_party_phase(p_lock BOOLEAN DEFAULT false)
RETURNS public.event_pricing_phases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booked INTEGER;
  v_held INTEGER;
  v_count INTEGER;
  v_phase public.event_pricing_phases;
  v_ratchet public.event_pricing_phases;
  v_state public.event_party_phase_state;
BEGIN
  IF p_lock THEN
    SELECT * INTO v_state FROM public.event_party_phase_state WHERE id = 1 FOR UPDATE;
  ELSE
    SELECT * INTO v_state FROM public.event_party_phase_state WHERE id = 1;
  END IF;

  IF v_state.id IS NULL THEN
    INSERT INTO public.event_party_phase_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    SELECT * INTO v_state FROM public.event_party_phase_state WHERE id = 1;
  END IF;

  SELECT booked, held INTO v_booked, v_held FROM public.get_party_entry_counts();
  v_count := COALESCE(v_booked, 0) + COALESCE(v_held, 0);

  v_phase := public.get_party_phase_for_count(v_count);

  IF v_phase.id IS NULL THEN
    RAISE EXCEPTION 'No active party phase is configured';
  END IF;

  IF v_phase.phase_number < COALESCE(v_state.highest_phase_number, 1) THEN
    SELECT * INTO v_ratchet
    FROM public.event_pricing_phases
    WHERE active = true AND phase_number = v_state.highest_phase_number;

    IF v_ratchet.id IS NOT NULL THEN
      v_phase := v_ratchet;
    END IF;
  END IF;

  IF v_phase.phase_number > COALESCE(v_state.highest_phase_number, 1)
     OR v_count > COALESCE(v_state.highest_party_count, 0) THEN
    UPDATE public.event_party_phase_state
    SET
      highest_phase_number = GREATEST(highest_phase_number, v_phase.phase_number),
      highest_party_count = GREATEST(highest_party_count, v_count),
      updated_at = now()
    WHERE id = 1;
  END IF;

  RETURN v_phase;
END;
$$;

-- Abandoned checkouts: cancel pending orders once their hold has been dead for a while.
-- A gateway webhook that lands later still flips the order to paid (captured payments are never rejected).
CREATE OR REPLACE FUNCTION public.expire_stale_event_orders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.event_orders
  SET payment_status = 'cancelled'
  WHERE payment_status IN ('pending', 'manual_payment')
    AND COALESCE(checkout_token_expires_at, created_at + interval '15 minutes') < now() - interval '10 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_event_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_stale_event_orders() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Public status feed for GET /api/party-status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_event_party_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booked INTEGER;
  v_held INTEGER;
  v_count INTEGER;
  v_phase public.event_pricing_phases;
  v_next public.event_pricing_phases;
  v_sessions JSONB;
BEGIN
  PERFORM public.expire_stale_event_orders();

  SELECT booked, held INTO v_booked, v_held FROM public.get_party_entry_counts();
  v_count := COALESCE(v_booked, 0) + COALESCE(v_held, 0);
  v_phase := public.resolve_party_phase(false);

  SELECT * INTO v_next
  FROM public.event_pricing_phases
  WHERE active = true AND phase_number = v_phase.phase_number + 1;

  SELECT COALESCE(jsonb_object_agg(
    counts.session_number::TEXT,
    jsonb_build_object(
      'booked', counts.booked,
      'held', counts.held,
      'cap', counts.seat_cap,
      'label', counts.slot_label
    )
  ), '{}'::jsonb)
  INTO v_sessions
  FROM public.get_session_seat_counts() AS counts;

  RETURN jsonb_build_object(
    'party', jsonb_build_object('booked', COALESCE(v_booked, 0), 'held', COALESCE(v_held, 0)),
    'sessions', v_sessions,
    'phase', jsonb_build_object(
      'number', v_phase.phase_number,
      'key', v_phase.phase_key,
      'name', v_phase.name,
      'price_inr', v_phase.party_price_inr,
      'min_party_count', v_phase.min_party_count,
      'next_price_inr', v_next.party_price_inr,
      'next_min_party_count', v_next.min_party_count,
      'remaining_in_phase', CASE WHEN v_next.id IS NULL THEN NULL ELSE GREATEST(v_next.min_party_count - v_count, 0) END,
      'party_count', v_count
    ),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_party_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_party_status() TO anon, authenticated;

COMMENT ON FUNCTION public.get_event_party_status() IS 'Live party phase + seat availability for pinkd.hashtag.dance (served as GET /api/party-status). Same counting rule as checkout.';

-- ---------------------------------------------------------------------------
-- 6b. Timed reveal: 1 Intensive and 2 Intensives open at 6 PM IST on 4 Sep 2026
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_packages
  ADD COLUMN IF NOT EXISTS available_from TIMESTAMPTZ;

COMMENT ON COLUMN public.event_packages.available_from IS 'When set, the pass is hidden on the booking page and refused at checkout until this moment.';

UPDATE public.event_packages
SET available_from = '2026-09-04 18:00:00+05:30', updated_at = now()
WHERE id IN ('one-intensive', 'two-intensives');

-- ---------------------------------------------------------------------------
-- 7. Landing-page checkout: server-priced, capacity-checked, no coins
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_event_order(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_cart_items JSONB,
  p_customer_studio TEXT
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_total NUMERIC(10,2) := 0;
  v_item JSONB;
  v_item_type TEXT;
  v_package public.event_packages%ROWTYPE;
  v_phase public.event_pricing_phases;
  v_session public.event_sessions%ROWTYPE;
  v_package_key TEXT;
  v_quantity INTEGER;
  v_selected_slots JSONB;
  v_slot TEXT;
  v_slot_count INTEGER;
  v_invalid_slot_count INTEGER;
  v_duplicate_slot_count INTEGER;
  v_seats_needed INTEGER;
  v_seats_taken INTEGER;
  v_line_total NUMERIC(10,2);
  v_effective_price NUMERIC(10,2);
  v_intensive_count INTEGER;
  v_customer_studio TEXT;
  v_allowed_studios TEXT[] := ARRAY[
    'Noida Sector 43 (NDA)',
    'Noida Sector 50 (RMG)',
    'Pitampura (PP)',
    'Rajouri Garden (RG)',
    'Preet Vihar (ED)',
    'Anand Vihar (AV)',
    'Gurgaon (GGN)',
    'Indirapuram (IPM)',
    'South Delhi (SD)',
    'Dwarka (DWK)',
    'Not a Student'
  ];
BEGIN
  v_customer_studio := NULLIF(trim(coalesce(p_customer_studio, '')), '');

  IF length(trim(coalesce(p_customer_name, ''))) = 0
    OR length(trim(coalesce(p_customer_phone, ''))) = 0
    OR length(trim(coalesce(p_customer_email, ''))) = 0 THEN
    RAISE EXCEPTION 'Customer name, phone, and email are required';
  END IF;

  IF v_customer_studio IS NOT NULL AND NOT (v_customer_studio = ANY (v_allowed_studios)) THEN
    RAISE EXCEPTION 'Please select a valid studio';
  END IF;

  IF jsonb_typeof(p_cart_items) <> 'array' OR jsonb_array_length(p_cart_items) = 0 THEN
    RAISE EXCEPTION 'Cart must include at least one item';
  END IF;

  IF jsonb_array_length(p_cart_items) > 50 THEN
    RAISE EXCEPTION 'Cart has too many items';
  END IF;

  -- One checkout at a time: the phase price and the seat caps are decided here,
  -- so two buyers can never both take the last seat or the last Phase 1 spot.
  PERFORM pg_advisory_xact_lock(hashtext('pinkd_event_checkout'));

  v_phase := public.resolve_party_phase(true);

  INSERT INTO public.event_orders (
    customer_name,
    customer_phone,
    customer_email,
    customer_studio,
    total_amount_inr,
    payment_status,
    booking_source
  )
  VALUES (
    trim(p_customer_name),
    trim(p_customer_phone),
    trim(p_customer_email),
    v_customer_studio,
    0,
    'manual_payment',
    'landing_page'
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items)
  LOOP
    v_item_type := coalesce(NULLIF(v_item ->> 'item_type', ''), 'event_package');
    v_package_key := v_item ->> 'package_key';
    v_quantity := NULLIF(v_item ->> 'quantity', '')::INTEGER;
    v_selected_slots := coalesce(v_item -> 'selected_time_slots', '[]'::jsonb);

    IF v_item_type = 'coin_package' OR v_package_key LIKE 'coin-package:%' THEN
      RAISE EXCEPTION 'Pink''d Coins are sold separately to party ticket holders after booking';
    END IF;

    IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 100 THEN
      RAISE EXCEPTION 'Invalid item quantity';
    END IF;

    IF jsonb_typeof(v_selected_slots) <> 'array' THEN
      RAISE EXCEPTION 'Time slots must be an array';
    END IF;

    SELECT *
    INTO v_package
    FROM public.event_packages
    WHERE id = v_package_key
      AND active = true;

    IF v_package.id IS NULL THEN
      RAISE EXCEPTION 'This event package is unavailable';
    END IF;

    IF v_package.available_from IS NOT NULL AND v_package.available_from > now() THEN
      RAISE EXCEPTION '% opens at % IST', v_package.name,
        to_char(v_package.available_from AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon, FMHH12:MI AM');
    END IF;

    -- Only party-only entries move with the phase. Bundles are flat.
    IF v_package.category = 'party' THEN
      v_effective_price := v_phase.party_price_inr;
    ELSE
      v_effective_price := v_package.price_inr;
    END IF;

    v_intensive_count := coalesce(v_package.intensive_count, 0);

    IF v_intensive_count >= 4 THEN
      SELECT jsonb_agg(sessions.slot_label ORDER BY sessions.session_number)
      INTO v_selected_slots
      FROM public.event_sessions sessions;
    ELSIF v_intensive_count > 0 THEN
      v_slot_count := jsonb_array_length(v_selected_slots);

      SELECT count(*)
      INTO v_invalid_slot_count
      FROM jsonb_array_elements_text(v_selected_slots) AS selected_slot(slot)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.event_sessions sessions WHERE sessions.slot_label = selected_slot.slot
      );

      SELECT v_slot_count - count(DISTINCT selected_slot.slot)
      INTO v_duplicate_slot_count
      FROM jsonb_array_elements_text(v_selected_slots) AS selected_slot(slot);

      IF v_slot_count <> v_intensive_count THEN
        RAISE EXCEPTION 'Please pick exactly % session% for %', v_intensive_count,
          CASE WHEN v_intensive_count = 1 THEN '' ELSE 's' END, v_package.name;
      END IF;

      IF v_invalid_slot_count > 0 OR v_duplicate_slot_count > 0 THEN
        RAISE EXCEPTION 'Invalid time-slot selection';
      END IF;
    ELSE
      v_selected_slots := '[]'::jsonb;
    END IF;

    -- Hard cap per session (120): paid seats + live holds + this cart line.
    IF v_intensive_count > 0 THEN
      v_seats_needed := v_quantity * coalesce(v_package.pax, 1);

      FOR v_slot IN SELECT slot FROM jsonb_array_elements_text(v_selected_slots) AS selected_slot(slot)
      LOOP
        SELECT * INTO v_session FROM public.event_sessions WHERE slot_label = v_slot;

        SELECT COALESCE(counts.booked, 0) + COALESCE(counts.held, 0)
        INTO v_seats_taken
        FROM public.get_session_seat_counts() AS counts
        WHERE counts.slot_label = v_slot;

        IF COALESCE(v_seats_taken, 0) + v_seats_needed > v_session.seat_cap THEN
          IF COALESCE(v_seats_taken, 0) >= v_session.seat_cap THEN
            RAISE EXCEPTION 'Sold out: % is full', v_slot;
          END IF;
          RAISE EXCEPTION 'Only % seat% left for %', v_session.seat_cap - COALESCE(v_seats_taken, 0),
            CASE WHEN v_session.seat_cap - COALESCE(v_seats_taken, 0) = 1 THEN '' ELSE 's' END, v_slot;
        END IF;
      END LOOP;
    END IF;

    v_line_total := v_effective_price * v_quantity;
    v_total := v_total + v_line_total;

    INSERT INTO public.event_order_items (
      order_id,
      package_key,
      package_category,
      package_name,
      unit_price_inr,
      quantity,
      pax,
      line_total_inr,
      selected_time_slots,
      phase_id,
      phase_name,
      phase_price_inr
    )
    VALUES (
      v_order_id,
      v_package.id,
      v_package.category,
      v_package.name,
      v_effective_price,
      v_quantity,
      v_package.pax,
      v_line_total,
      v_selected_slots,
      CASE WHEN v_package.category = 'party' THEN v_phase.id ELSE NULL END,
      CASE WHEN v_package.category = 'party' THEN v_phase.name ELSE NULL END,
      CASE WHEN v_package.category = 'party' THEN v_effective_price ELSE NULL END
    );
  END LOOP;

  UPDATE public.event_orders
  SET total_amount_inr = v_total
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB, TEXT) IS 'Creates a Pink''d landing-page order. Party entries are priced from the live phase, intensives are checked against the 120-seat session caps, coins are refused (sold on /coins).';

-- ---------------------------------------------------------------------------
-- 8. Coins page: look up a paid party ticket, then buy coins against it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_phone_digits(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT right(regexp_replace(coalesce(p_value, ''), '\D', '', 'g'), 10);
$$;

-- Finds the most recent paid order with a party entry matching an order ref
-- (first 8 chars of the id) or the email / phone used at booking.
CREATE OR REPLACE FUNCTION public.find_paid_party_order(p_order_ref TEXT, p_contact TEXT)
RETURNS public.event_orders
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref TEXT := upper(trim(coalesce(p_order_ref, '')));
  v_contact TEXT := lower(trim(coalesce(p_contact, '')));
  v_phone TEXT := public.normalize_phone_digits(p_contact);
  v_order public.event_orders;
BEGIN
  IF length(v_ref) < 6 AND length(v_contact) < 5 THEN
    RETURN NULL;
  END IF;

  SELECT orders.*
  INTO v_order
  FROM public.event_orders orders
  WHERE orders.booking_source = 'landing_page'
    AND public.event_order_is_paid(orders.payment_status)
    AND EXISTS (
      SELECT 1 FROM public.event_order_items items
      WHERE items.order_id = orders.id
        AND items.package_category IN ('party', 'package', 'group')
    )
    AND (
      (length(v_ref) >= 6 AND upper(left(orders.id::TEXT, length(v_ref))) = v_ref)
      OR (length(v_contact) >= 5 AND lower(orders.customer_email) = v_contact)
      OR (length(v_phone) = 10 AND public.normalize_phone_digits(orders.customer_phone) = v_phone)
    )
  ORDER BY orders.paid_at DESC NULLS LAST, orders.created_at DESC
  LIMIT 1;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_party_order(p_order_ref TEXT, p_contact TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
  v_party_entries INTEGER;
  v_coins_purchased INTEGER;
  v_coins_pending INTEGER;
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

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_ref', upper(left(v_order.id::TEXT, 8)),
    'first_name', split_part(trim(v_order.customer_name), ' ', 1),
    'party_entries', v_party_entries,
    'coins_purchased', v_coins_purchased,
    'coins_pending', v_coins_pending,
    'paid_at', v_order.paid_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_party_order(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_party_order(TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_party_order(TEXT, TEXT) IS 'Gate for /coins: returns a minimal summary of a paid party-ticket order matched by order ref or booking email/phone, or NULL.';

CREATE OR REPLACE FUNCTION public.create_coin_order_checkout(
  p_parent_order_id UUID,
  p_proof TEXT,
  p_cart_items JSONB,
  p_checkout_token_hash TEXT,
  p_attribution JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent public.event_orders;
  v_matched public.event_orders;
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

  -- The proof must resolve to the same order (order ref, or the booking email / phone).
  v_matched := public.find_paid_party_order(p_proof, p_proof);
  IF v_matched.id IS NULL OR v_matched.id <> v_parent.id THEN
    IF NOT (
      upper(trim(coalesce(p_proof, ''))) = upper(left(v_parent.id::TEXT, 8))
      OR lower(trim(coalesce(p_proof, ''))) = lower(v_parent.customer_email)
      OR (length(public.normalize_phone_digits(p_proof)) = 10 AND public.normalize_phone_digits(p_proof) = public.normalize_phone_digits(v_parent.customer_phone))
    ) THEN
      RAISE EXCEPTION 'We could not match that order reference, email or phone to a paid party ticket';
    END IF;
  END IF;

  INSERT INTO public.event_orders (
    customer_name,
    customer_phone,
    customer_email,
    customer_studio,
    total_amount_inr,
    payment_status,
    booking_source,
    parent_order_id,
    checkout_token_hash,
    checkout_token_expires_at,
    attribution
  )
  VALUES (
    v_parent.customer_name,
    v_parent.customer_phone,
    v_parent.customer_email,
    v_parent.customer_studio,
    0,
    'manual_payment',
    'coins_page',
    v_parent.id,
    lower(trim(p_checkout_token_hash)),
    now() + interval '15 minutes',
    coalesce(p_attribution, '{}'::jsonb)
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

    SELECT * INTO v_coin_package
    FROM public.coin_packages
    WHERE id = v_coin_package_id_text::UUID
      AND active = true;

    IF v_coin_package.id IS NULL THEN
      RAISE EXCEPTION 'This Pink''d Coin pack is unavailable';
    END IF;

    v_line_total := v_coin_package.inr_amount * v_quantity;
    v_total := v_total + v_line_total;

    INSERT INTO public.event_order_items (
      order_id,
      package_key,
      package_category,
      package_name,
      unit_price_inr,
      quantity,
      pax,
      line_total_inr,
      selected_time_slots
    )
    VALUES (
      v_order_id,
      'coin-package:' || v_coin_package.id::TEXT,
      'coins',
      v_coin_package.coin_amount::TEXT || ' Pink''d Coins',
      v_coin_package.inr_amount,
      v_quantity,
      NULL,
      v_line_total,
      '[]'::jsonb
    );
  END LOOP;

  UPDATE public.event_orders
  SET total_amount_inr = v_total
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.create_coin_order_checkout(UUID, TEXT, JSONB, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_coin_order_checkout(UUID, TEXT, JSONB, TEXT, JSONB) TO anon, authenticated;

COMMENT ON FUNCTION public.create_coin_order_checkout(UUID, TEXT, JSONB, TEXT, JSONB) IS 'Creates a Pink''d Coin order (booking_source = coins_page) linked to a paid party-ticket order. Coin revenue stays on its own orders, separate from ticket revenue.';

-- Coins bought online against a ticket, for the issue-tag counter and the confirmation email.
CREATE OR REPLACE FUNCTION public.get_prepaid_coins_for_order(p_parent_order_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(packages.coin_amount * items.quantity), 0)::INTEGER
  FROM public.event_orders coin_orders
  JOIN public.event_order_items items ON items.order_id = coin_orders.id AND items.package_category = 'coins'
  JOIN public.coin_packages packages ON packages.id::TEXT = replace(items.package_key, 'coin-package:', '')
  WHERE coin_orders.parent_order_id = p_parent_order_id
    AND public.event_order_is_paid(coin_orders.payment_status);
$$;

REVOKE ALL ON FUNCTION public.get_prepaid_coins_for_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_prepaid_coins_for_order(UUID) TO authenticated;
