-- Cart-based Pink'D event orders. This is intentionally separate from NFC wallet
-- Pink'D Coin accounting and transaction tables.

CREATE TABLE IF NOT EXISTS public.event_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0),
  customer_phone TEXT NOT NULL CHECK (length(trim(customer_phone)) > 0),
  customer_email TEXT NOT NULL CHECK (length(trim(customer_email)) > 0),
  total_amount_inr NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_amount_inr >= 0),
  payment_status TEXT NOT NULL DEFAULT 'manual_payment',
  payment_reference TEXT,
  booking_source TEXT NOT NULL DEFAULT 'landing_page',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_orders_payment_status_check
    CHECK (payment_status IN ('pending', 'manual_payment', 'paid', 'completed', 'failed', 'cancelled', 'refunded'))
);

CREATE TABLE IF NOT EXISTS public.event_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.event_orders(id) ON DELETE CASCADE,
  package_key TEXT NOT NULL,
  package_category TEXT NOT NULL CHECK (package_category IN ('intensives', 'party', 'package', 'group')),
  package_name TEXT NOT NULL,
  unit_price_inr NUMERIC(10,2) NOT NULL CHECK (unit_price_inr > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 100),
  pax INTEGER CHECK (pax IS NULL OR pax > 0),
  line_total_inr NUMERIC(10,2) NOT NULL CHECK (line_total_inr >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_orders_created_at_idx ON public.event_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS event_orders_payment_status_idx ON public.event_orders (payment_status);
CREATE INDEX IF NOT EXISTS event_order_items_order_id_idx ON public.event_order_items (order_id);
CREATE INDEX IF NOT EXISTS event_order_items_package_key_idx ON public.event_order_items (package_key);

ALTER TABLE public.event_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_order_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_orders FROM anon, authenticated;
REVOKE ALL ON TABLE public.event_order_items FROM anon, authenticated;

GRANT SELECT, UPDATE ON public.event_orders TO authenticated;
GRANT SELECT ON public.event_order_items TO authenticated;

DROP POLICY IF EXISTS "Admins can view event orders" ON public.event_orders;
DROP POLICY IF EXISTS "Admins can update event order payment status" ON public.event_orders;
DROP POLICY IF EXISTS "Admins can view event order items" ON public.event_order_items;

CREATE POLICY "Admins can view event orders"
ON public.event_orders
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can update event order payment status"
ON public.event_orders
FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can view event order items"
ON public.event_order_items
FOR SELECT
TO authenticated
USING (
  public.get_current_user_role() = 'admin'
  AND EXISTS (
    SELECT 1
    FROM public.event_orders
    WHERE event_orders.id = event_order_items.order_id
  )
);

DROP TRIGGER IF EXISTS update_event_orders_updated_at ON public.event_orders;
CREATE TRIGGER update_event_orders_updated_at
  BEFORE UPDATE ON public.event_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

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

    IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 100 THEN
      RAISE EXCEPTION 'Invalid item quantity';
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

    v_pax := CASE v_package_key
      WHEN 'six-pax-four-intensives-party' THEN 6
      WHEN 'ten-pax-four-intensives-party' THEN 10
      ELSE NULL
    END;

    IF v_package_name IS NULL OR v_package_category IS NULL OR v_unit_price IS NULL THEN
      RAISE EXCEPTION 'Unknown event package';
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
      line_total_inr
    )
    VALUES (
      v_order_id,
      v_package_key,
      v_package_category,
      v_package_name,
      v_unit_price,
      v_quantity,
      v_pax,
      v_line_total
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

COMMENT ON TABLE public.event_orders IS 'Pink''D event landing-page cart orders in INR. Separate from NFC wallet Pink''D Coins.';
COMMENT ON TABLE public.event_order_items IS 'Line items for Pink''D event landing-page cart orders.';
COMMENT ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) IS 'Creates a Pink''D landing-page order and line items from the fixed event package price map.';
