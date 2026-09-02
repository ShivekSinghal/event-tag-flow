-- Capture the customer's studio on Pink'D landing-page event orders.

ALTER TABLE public.event_orders
ADD COLUMN IF NOT EXISTS customer_studio TEXT;

ALTER TABLE public.event_orders DROP CONSTRAINT IF EXISTS event_orders_customer_studio_check;
ALTER TABLE public.event_orders
ADD CONSTRAINT event_orders_customer_studio_check
CHECK (
  customer_studio IS NULL
  OR customer_studio = ANY (ARRAY[
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
  ])
);

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
  v_package_key TEXT;
  v_coin_package_id_text TEXT;
  v_coin_package_id UUID;
  v_quantity INTEGER;
  v_selected_slots JSONB;
  v_slot_count INTEGER;
  v_invalid_slot_count INTEGER;
  v_duplicate_slot_count INTEGER;
  v_line_total NUMERIC(10,2);
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

      v_line_total := v_package.price_inr * v_quantity;
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
        v_package.id,
        v_package.category,
        v_package.name,
        v_package.price_inr,
        v_quantity,
        v_package.pax,
        v_line_total,
        v_selected_slots
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
  p_customer_studio TEXT
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_total_amount_inr NUMERIC;
BEGIN
  IF lower(trim(coalesce(p_checkout_token_hash, ''))) !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Valid checkout token hash is required';
  END IF;

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
    checkout_token_expires_at = now() + interval '30 minutes'
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total_amount_inr;
END;
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
    NULL::TEXT
  );
$$;

REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;

COMMENT ON COLUMN public.event_orders.customer_studio IS 'Studio selected by the customer during Pink''D landing-page checkout.';
