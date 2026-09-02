-- Store and validate intensive time-slot selections for Pink'D event cart items.

ALTER TABLE public.event_order_items
ADD COLUMN IF NOT EXISTS selected_time_slots JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.event_order_items DROP CONSTRAINT IF EXISTS event_order_items_selected_time_slots_array;
ALTER TABLE public.event_order_items
ADD CONSTRAINT event_order_items_selected_time_slots_array
CHECK (jsonb_typeof(selected_time_slots) = 'array');

CREATE OR REPLACE FUNCTION public.create_event_order(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_cart_items JSONB
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
  v_package_key TEXT;
  v_package_name TEXT;
  v_package_category TEXT;
  v_unit_price NUMERIC(10,2);
  v_quantity INTEGER;
  v_pax INTEGER;
  v_intensive_count INTEGER;
  v_selected_slots JSONB;
  v_slot_count INTEGER;
  v_invalid_slot_count INTEGER;
  v_duplicate_slot_count INTEGER;
  v_line_total NUMERIC(10,2);
BEGIN
  IF length(trim(coalesce(p_customer_name, ''))) = 0
    OR length(trim(coalesce(p_customer_phone, ''))) = 0
    OR length(trim(coalesce(p_customer_email, ''))) = 0 THEN
    RAISE EXCEPTION 'Customer name, phone, and email are required';
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
    total_amount_inr,
    payment_status,
    booking_source
  )
  VALUES (
    trim(p_customer_name),
    trim(p_customer_phone),
    trim(p_customer_email),
    0,
    'manual_payment',
    'landing_page'
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart_items)
  LOOP
    v_package_key := v_item ->> 'package_key';
    v_quantity := NULLIF(v_item ->> 'quantity', '')::INTEGER;
    v_selected_slots := coalesce(v_item -> 'selected_time_slots', '[]'::jsonb);

    IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 100 THEN
      RAISE EXCEPTION 'Invalid item quantity';
    END IF;

    IF jsonb_typeof(v_selected_slots) <> 'array' THEN
      RAISE EXCEPTION 'Time slots must be an array';
    END IF;

    v_package_name := CASE v_package_key
      WHEN 'one-intensive' THEN '1 Intensive'
      WHEN 'two-intensives' THEN '2 Intensives'
      WHEN 'four-intensives' THEN '4 Intensives'
      WHEN 'party-entry' THEN 'Party Entry'
      WHEN 'four-intensives-party' THEN '4 Intensives + Party'
      WHEN 'six-pax-four-intensives-party' THEN '6 Pax · 4 Intensives + Party'
      WHEN 'ten-pax-four-intensives-party' THEN '10 Pax · 4 Intensives + Party'
      ELSE NULL
    END;

    v_package_category := CASE v_package_key
      WHEN 'one-intensive' THEN 'intensives'
      WHEN 'two-intensives' THEN 'intensives'
      WHEN 'four-intensives' THEN 'intensives'
      WHEN 'party-entry' THEN 'party'
      WHEN 'four-intensives-party' THEN 'package'
      WHEN 'six-pax-four-intensives-party' THEN 'group'
      WHEN 'ten-pax-four-intensives-party' THEN 'group'
      ELSE NULL
    END;

    v_unit_price := CASE v_package_key
      WHEN 'one-intensive' THEN 1499
      WHEN 'two-intensives' THEN 2699
      WHEN 'four-intensives' THEN 4499
      WHEN 'party-entry' THEN 2000
      WHEN 'four-intensives-party' THEN 5500
      WHEN 'six-pax-four-intensives-party' THEN 30000
      WHEN 'ten-pax-four-intensives-party' THEN 48000
      ELSE NULL
    END;

    v_intensive_count := CASE v_package_key
      WHEN 'one-intensive' THEN 1
      WHEN 'two-intensives' THEN 2
      WHEN 'four-intensives' THEN 4
      WHEN 'four-intensives-party' THEN 4
      WHEN 'six-pax-four-intensives-party' THEN 4
      WHEN 'ten-pax-four-intensives-party' THEN 4
      ELSE 0
    END;

    v_pax := CASE v_package_key
      WHEN 'six-pax-four-intensives-party' THEN 6
      WHEN 'ten-pax-four-intensives-party' THEN 10
      ELSE NULL
    END;

    IF v_package_name IS NULL OR v_package_category IS NULL OR v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Unknown event package';
    END IF;

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

    v_line_total := v_unit_price * v_quantity;
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
      v_package_key,
      v_package_category,
      v_package_name,
      v_unit_price,
      v_quantity,
      v_pax,
      v_line_total,
      v_selected_slots
    );
  END LOOP;

  UPDATE public.event_orders
  SET total_amount_inr = v_total
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

COMMENT ON COLUMN public.event_order_items.selected_time_slots IS 'Selected intensive schedule slots for this cart line. Four-intensive packages store all four slots.';
