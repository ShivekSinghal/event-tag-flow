-- Admin-controlled event package catalog for the Pink'D landing page.
-- Event booking INR revenue stays separate from NFC wallet Pink'D Coins.

CREATE TABLE IF NOT EXISTS public.event_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (category IN ('intensives', 'party', 'package', 'group')),
  description TEXT NOT NULL DEFAULT '',
  price_inr NUMERIC(10,2) NOT NULL CHECK (price_inr > 0),
  intensive_count INTEGER CHECK (intensive_count IS NULL OR intensive_count >= 0),
  pax INTEGER CHECK (pax IS NULL OR pax > 0),
  featured BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.event_packages (
  id,
  name,
  category,
  description,
  price_inr,
  intensive_count,
  pax,
  featured,
  active,
  display_order
)
VALUES
  ('one-intensive', '1 Intensive', 'intensives', 'Single workshop pass', 1499, 1, NULL, false, true, 10),
  ('two-intensives', '2 Intensives', 'intensives', 'Two workshop pass', 2699, 2, NULL, false, true, 20),
  ('four-intensives', '4 Intensives', 'intensives', 'Full intensive pass', 4499, 4, NULL, false, true, 30),
  ('party-entry', 'Party Entry', 'party', 'Entry to the Pink''D party', 2000, NULL, NULL, false, true, 40),
  ('four-intensives-party', '4 Intensives + Party', 'package', 'Full workshop pass with party access', 5500, 4, NULL, true, true, 50),
  ('six-pax-four-intensives-party', '6 Pax · 4 Intensives + Party', 'group', 'Group booking for six attendees', 30000, 4, 6, false, true, 60),
  ('ten-pax-four-intensives-party', '10 Pax · 4 Intensives + Party', 'group', 'Group booking for ten attendees', 48000, 4, 10, false, true, 70)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  price_inr = EXCLUDED.price_inr,
  intensive_count = EXCLUDED.intensive_count,
  pax = EXCLUDED.pax,
  featured = EXCLUDED.featured,
  active = public.event_packages.active,
  display_order = EXCLUDED.display_order,
  updated_at = now();

CREATE INDEX IF NOT EXISTS event_packages_category_idx ON public.event_packages (category, display_order);
CREATE INDEX IF NOT EXISTS event_packages_active_idx ON public.event_packages (active, display_order);

ALTER TABLE public.event_packages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_packages FROM anon, authenticated;
GRANT SELECT ON public.event_packages TO anon, authenticated;
GRANT UPDATE ON public.event_packages TO authenticated;

DROP POLICY IF EXISTS "Public can view active event packages" ON public.event_packages;
DROP POLICY IF EXISTS "Admins can view all event packages" ON public.event_packages;
DROP POLICY IF EXISTS "Admins can update event packages" ON public.event_packages;

CREATE POLICY "Public can view active event packages"
ON public.event_packages
FOR SELECT
TO anon, authenticated
USING (active = true);

CREATE POLICY "Admins can view all event packages"
ON public.event_packages
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can update event packages"
ON public.event_packages
FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

DROP TRIGGER IF EXISTS update_event_packages_updated_at ON public.event_packages;
CREATE TRIGGER update_event_packages_updated_at
  BEFORE UPDATE ON public.event_packages
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
  v_package public.event_packages%ROWTYPE;
  v_package_key TEXT;
  v_quantity INTEGER;
  v_selected_slots JSONB;
  v_slot_count INTEGER;
  v_invalid_slot_count INTEGER;
  v_duplicate_slot_count INTEGER;
  v_line_total NUMERIC(10,2);
  v_intensive_count INTEGER;
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
  END LOOP;

  UPDATE public.event_orders
  SET total_amount_inr = v_total
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;

COMMENT ON TABLE public.event_packages IS 'Admin-controlled Pink''D event landing-page package catalog in INR.';
COMMENT ON FUNCTION public.create_event_order(TEXT, TEXT, TEXT, JSONB) IS 'Creates a Pink''D landing-page order from active event package settings and stores the exact sold line items.';
