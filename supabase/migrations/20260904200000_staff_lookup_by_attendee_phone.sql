-- Gate lookup: find a booking by a crew member's own phone (band or attendee form),
-- not only by the booker's details. Same fallback the public /coins lookup uses.

CREATE OR REPLACE FUNCTION public.staff_lookup_party_order(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- Gate fix (4 Sep 2026): crew members arrive with their OWN phone, not the booker's.
  -- Fall back to the phone on an already-issued band, then to the attendee-form phone.
  IF v_order.id IS NULL AND length(public.normalize_phone_digits(p_query)) = 10 THEN
    SELECT orders.* INTO v_order
    FROM public.wallets w
    JOIN public.event_orders orders ON orders.id = w.event_order_id
    WHERE w.status = 'active'
      AND public.normalize_phone_digits(w.attendee_phone) = public.normalize_phone_digits(p_query)
      AND public.event_order_is_paid(orders.payment_status)
    ORDER BY w.created_at DESC
    LIMIT 1;

    IF v_order.id IS NULL THEN
      SELECT orders.* INTO v_order
      FROM public.event_order_attendees a
      JOIN public.event_orders orders ON orders.id = a.order_id
      WHERE public.normalize_phone_digits(a.attendee_phone) = public.normalize_phone_digits(p_query)
        AND public.event_order_is_paid(orders.payment_status)
      ORDER BY a.created_at DESC
      LIMIT 1;
    END IF;
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.staff_lookup_party_order(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_lookup_party_order(TEXT) TO authenticated;
