CREATE TABLE IF NOT EXISTS public.event_pricing_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_key TEXT NOT NULL UNIQUE CHECK (phase_key IN ('early_bird', 'phase_1', 'last_call')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_package_phase_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id UUID NOT NULL REFERENCES public.event_pricing_phases(id) ON DELETE CASCADE,
  package_id TEXT NOT NULL REFERENCES public.event_packages(id) ON DELETE CASCADE,
  capacity INTEGER NOT NULL DEFAULT 40 CHECK (capacity >= 0),
  display_registration_boost INTEGER NOT NULL DEFAULT 0 CHECK (display_registration_boost >= 0),
  price_inr NUMERIC(10,2) NOT NULL CHECK (price_inr > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (phase_id, package_id)
);

ALTER TABLE public.event_order_items
ADD COLUMN IF NOT EXISTS phase_id UUID REFERENCES public.event_pricing_phases(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS phase_name TEXT,
ADD COLUMN IF NOT EXISTS phase_price_inr NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS event_pricing_phases_active_idx
ON public.event_pricing_phases (active, display_order);

CREATE INDEX IF NOT EXISTS event_package_phase_limits_phase_package_idx
ON public.event_package_phase_limits (phase_id, package_id);

CREATE INDEX IF NOT EXISTS event_order_items_phase_package_idx
ON public.event_order_items (phase_id, package_key);

INSERT INTO public.event_pricing_phases (phase_key, name, active, starts_at, ends_at, display_order)
VALUES
  ('early_bird', 'Early Bird', true, '2026-09-02 00:00:00+05:30', '2026-09-05 23:59:00+05:30', 10),
  ('phase_1', 'Phase 1', true, '2026-09-06 00:00:00+05:30', '2026-09-09 23:59:00+05:30', 20),
  ('last_call', 'Last Call', true, '2026-09-10 00:00:00+05:30', NULL, 30)
ON CONFLICT (phase_key) DO UPDATE
SET
  name = EXCLUDED.name,
  display_order = EXCLUDED.display_order,
  updated_at = now();

INSERT INTO public.event_package_phase_limits (
  phase_id,
  package_id,
  capacity,
  display_registration_boost,
  price_inr,
  active
)
SELECT
  phase.id,
  package.id,
  40,
  CASE
    WHEN phase.phase_key = 'early_bird' AND package.id = 'four-intensives-party' THEN 13
    WHEN phase.phase_key = 'early_bird' AND package.category = 'group' THEN 5
    WHEN phase.phase_key = 'early_bird' THEN 8
    ELSE 0
  END,
  package.price_inr,
  true
FROM public.event_pricing_phases AS phase
CROSS JOIN public.event_packages AS package
ON CONFLICT (phase_id, package_id) DO NOTHING;

ALTER TABLE public.event_pricing_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_package_phase_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_pricing_phases FROM anon, authenticated;
REVOKE ALL ON TABLE public.event_package_phase_limits FROM anon, authenticated;

GRANT SELECT ON public.event_pricing_phases TO anon, authenticated;
GRANT SELECT ON public.event_package_phase_limits TO anon, authenticated;
GRANT UPDATE ON public.event_pricing_phases TO authenticated;
GRANT UPDATE ON public.event_package_phase_limits TO authenticated;

DROP POLICY IF EXISTS "Public can view active event pricing phases" ON public.event_pricing_phases;
DROP POLICY IF EXISTS "Admins can view all event pricing phases" ON public.event_pricing_phases;
DROP POLICY IF EXISTS "Admins can update event pricing phases" ON public.event_pricing_phases;

CREATE POLICY "Public can view active event pricing phases"
ON public.event_pricing_phases
FOR SELECT
TO anon, authenticated
USING (active = true);

CREATE POLICY "Admins can view all event pricing phases"
ON public.event_pricing_phases
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can update event pricing phases"
ON public.event_pricing_phases
FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

DROP POLICY IF EXISTS "Public can view active event package phase limits" ON public.event_package_phase_limits;
DROP POLICY IF EXISTS "Admins can view all event package phase limits" ON public.event_package_phase_limits;
DROP POLICY IF EXISTS "Admins can update event package phase limits" ON public.event_package_phase_limits;

CREATE POLICY "Public can view active event package phase limits"
ON public.event_package_phase_limits
FOR SELECT
TO anon, authenticated
USING (
  active = true
  AND EXISTS (
    SELECT 1
    FROM public.event_pricing_phases phase
    WHERE phase.id = event_package_phase_limits.phase_id
      AND phase.active = true
  )
);

CREATE POLICY "Admins can view all event package phase limits"
ON public.event_package_phase_limits
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can update event package phase limits"
ON public.event_package_phase_limits
FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

DROP TRIGGER IF EXISTS update_event_pricing_phases_updated_at ON public.event_pricing_phases;
CREATE TRIGGER update_event_pricing_phases_updated_at
  BEFORE UPDATE ON public.event_pricing_phases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_package_phase_limits_updated_at ON public.event_package_phase_limits;
CREATE TRIGGER update_event_package_phase_limits_updated_at
  BEFORE UPDATE ON public.event_package_phase_limits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_event_phase_package_stats()
RETURNS TABLE(
  phase_id UUID,
  package_id TEXT,
  confirmed_quantity BIGINT,
  pending_quantity BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    limits.phase_id,
    limits.package_id,
    COALESCE(
      SUM(items.quantity) FILTER (
        WHERE orders.payment_status IN ('paid', 'completed')
      ),
      0
    )::BIGINT AS confirmed_quantity,
    COALESCE(
      SUM(items.quantity) FILTER (
        WHERE orders.payment_status IN ('pending', 'manual_payment')
          AND COALESCE(orders.checkout_token_expires_at, orders.created_at + interval '30 minutes') > now()
      ),
      0
    )::BIGINT AS pending_quantity
  FROM public.event_package_phase_limits limits
  LEFT JOIN public.event_order_items items
    ON items.phase_id = limits.phase_id
    AND items.package_key = limits.package_id
  LEFT JOIN public.event_orders orders
    ON orders.id = items.order_id
  GROUP BY limits.phase_id, limits.package_id;
$$;

REVOKE ALL ON FUNCTION public.get_event_phase_package_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_phase_package_stats() TO anon, authenticated;

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
  v_coin_package public.coin_packages%ROWTYPE;
  v_phase public.event_pricing_phases%ROWTYPE;
  v_phase_limit public.event_package_phase_limits%ROWTYPE;
  v_package_key TEXT;
  v_coin_package_id_text TEXT;
  v_coin_package_id UUID;
  v_quantity INTEGER;
  v_selected_slots JSONB;
  v_slot_count INTEGER;
  v_invalid_slot_count INTEGER;
  v_duplicate_slot_count INTEGER;
  v_reserved_quantity INTEGER;
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

  SELECT *
  INTO v_phase
  FROM public.event_pricing_phases
  WHERE active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at > now())
  ORDER BY display_order ASC
  LIMIT 1;

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

    IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 100 THEN
      RAISE EXCEPTION 'Invalid item quantity';
    END IF;

    IF jsonb_typeof(v_selected_slots) <> 'array' THEN
      RAISE EXCEPTION 'Time slots must be an array';
    END IF;

    IF v_item_type = 'coin_package' THEN
      v_coin_package_id_text := NULLIF(v_item ->> 'coin_package_id', '');

      IF v_coin_package_id_text IS NULL AND v_package_key LIKE 'coin-package:%' THEN
        v_coin_package_id_text := replace(v_package_key, 'coin-package:', '');
      END IF;

      IF v_coin_package_id_text IS NULL
        OR v_coin_package_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Invalid Pink''D Coin package';
      END IF;

      v_coin_package_id := v_coin_package_id_text::UUID;

      SELECT *
      INTO v_coin_package
      FROM public.coin_packages
      WHERE id = v_coin_package_id
        AND active = true;

      IF v_coin_package.id IS NULL THEN
        RAISE EXCEPTION 'This Pink''D Coin package is unavailable';
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
        v_coin_package.coin_amount::TEXT || ' Pink''D Coins',
        v_coin_package.inr_amount,
        v_quantity,
        NULL,
        v_line_total,
        '[]'::jsonb
      );
    ELSE
      SELECT *
      INTO v_package
      FROM public.event_packages
      WHERE id = v_package_key
        AND active = true;

      IF v_package.id IS NULL THEN
        RAISE EXCEPTION 'This event package is unavailable';
      END IF;

      v_effective_price := v_package.price_inr;

      IF v_phase.id IS NOT NULL THEN
        SELECT *
        INTO v_phase_limit
        FROM public.event_package_phase_limits
        WHERE phase_id = v_phase.id
          AND package_id = v_package.id
        FOR UPDATE;

        IF v_phase_limit.id IS NULL OR v_phase_limit.active = false THEN
          RAISE EXCEPTION 'This package is unavailable in the current booking phase';
        END IF;

        SELECT COALESCE(SUM(items.quantity), 0)::INTEGER
        INTO v_reserved_quantity
        FROM public.event_order_items items
        JOIN public.event_orders orders ON orders.id = items.order_id
        WHERE items.phase_id = v_phase.id
          AND items.package_key = v_package.id
          AND (
            orders.id = v_order_id
            OR orders.payment_status IN ('paid', 'completed')
            OR (
              orders.payment_status IN ('pending', 'manual_payment')
              AND COALESCE(orders.checkout_token_expires_at, orders.created_at + interval '30 minutes') > now()
            )
          );

        IF v_reserved_quantity + v_quantity > v_phase_limit.capacity THEN
          RAISE EXCEPTION 'Only % passes left for % in %',
            GREATEST(v_phase_limit.capacity - v_reserved_quantity, 0),
            v_package.name,
            v_phase.name;
        END IF;

        v_effective_price := v_phase_limit.price_inr;
      END IF;

      v_intensive_count := coalesce(v_package.intensive_count, 0);

      IF v_intensive_count >= 4 THEN
        v_selected_slots := jsonb_build_array(
          'Wednesday, Sept 9 @ 6:00 PM',
          'Wednesday, Sept 9 @ 8:00 PM',
          'Thursday, Sept 10 @ 6:00 PM',
          'Thursday, Sept 10 @ 8:00 PM'
        );
      ELSIF v_intensive_count > 0 THEN
        v_slot_count := jsonb_array_length(v_selected_slots);

        SELECT count(*)
        INTO v_invalid_slot_count
        FROM jsonb_array_elements_text(v_selected_slots) AS selected_slot(slot)
        WHERE selected_slot.slot NOT IN (
          'Wednesday, Sept 9 @ 6:00 PM',
          'Wednesday, Sept 9 @ 8:00 PM',
          'Thursday, Sept 10 @ 6:00 PM',
          'Thursday, Sept 10 @ 8:00 PM'
        );

        SELECT v_slot_count - count(DISTINCT selected_slot.slot)
        INTO v_duplicate_slot_count
        FROM jsonb_array_elements_text(v_selected_slots) AS selected_slot(slot);

        IF v_slot_count < 1 OR v_slot_count > v_intensive_count THEN
          RAISE EXCEPTION 'Please adjust your time-slot selection or upgrade your package';
        END IF;

        IF v_invalid_slot_count > 0 OR v_duplicate_slot_count > 0 THEN
          RAISE EXCEPTION 'Invalid time-slot selection';
        END IF;
      ELSE
        v_selected_slots := '[]'::jsonb;
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
        NULLIF(v_phase.id, '00000000-0000-0000-0000-000000000000'::UUID),
        CASE WHEN v_phase.id IS NULL THEN NULL ELSE v_phase.name END,
        CASE WHEN v_phase.id IS NULL THEN NULL ELSE v_effective_price END
      );
    END IF;
  END LOOP;

  UPDATE public.event_orders
  SET total_amount_inr = v_total
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_event_order(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_cart_items JSONB
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM public.create_event_order(
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_cart_items,
    NULL::TEXT
  );
$$;

REVOKE ALL ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_event_order_checkout(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_cart_items JSONB,
  p_checkout_token_hash TEXT,
  p_customer_studio TEXT,
  p_attribution JSONB
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_total_amount_inr NUMERIC;
  v_attribution JSONB;
BEGIN
  IF lower(trim(coalesce(p_checkout_token_hash, ''))) !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Valid checkout token hash is required';
  END IF;

  IF p_attribution IS NOT NULL AND jsonb_typeof(p_attribution) <> 'object' THEN
    RAISE EXCEPTION 'Attribution must be a JSON object';
  END IF;

  v_attribution := coalesce(p_attribution, '{}'::jsonb);

  SELECT created.order_id, created.total_amount_inr
  INTO v_order_id, v_total_amount_inr
  FROM public.create_event_order(
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_cart_items,
    p_customer_studio
  ) AS created;

  UPDATE public.event_orders
  SET
    checkout_token_hash = lower(trim(p_checkout_token_hash)),
    checkout_token_expires_at = now() + interval '30 minutes',
    attribution = v_attribution
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total_amount_inr;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_event_order_checkout(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_cart_items JSONB,
  p_checkout_token_hash TEXT,
  p_customer_studio TEXT
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM public.create_event_order_checkout(
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_cart_items,
    p_checkout_token_hash,
    p_customer_studio,
    '{}'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_event_order_checkout(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_cart_items JSONB,
  p_checkout_token_hash TEXT
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT *
  FROM public.create_event_order_checkout(
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_cart_items,
    p_checkout_token_hash,
    NULL::TEXT,
    '{}'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;

COMMENT ON TABLE public.event_pricing_phases IS 'Admin-controlled Pink''D event booking phases such as Early Bird, Phase 1, and Last Call.';
COMMENT ON TABLE public.event_package_phase_limits IS 'Per-phase package price, capacity, availability, and display boost for Pink''D landing-page urgency.';
COMMENT ON COLUMN public.event_package_phase_limits.display_registration_boost IS 'Admin-controlled social-proof display count. This is never included in actual sold/revenue reports.';
COMMENT ON COLUMN public.event_order_items.phase_id IS 'Booking phase used when this event item was reserved.';
COMMENT ON COLUMN public.event_order_items.phase_price_inr IS 'Frozen INR unit price used for the package in its booking phase.';
