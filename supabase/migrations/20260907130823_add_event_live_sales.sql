-- Administrative sales are actual paid admissions, not the landing-page ratchet.
CREATE OR REPLACE FUNCTION public.get_event_live_sales()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_report JSONB;
BEGIN
  IF auth.uid() IS NULL OR public.get_current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  WITH event_items AS MATERIALIZED (
    SELECT
      i.id, i.order_id, i.package_key, i.package_category, i.pax,
      i.quantity::BIGINT * COALESCE(i.pax, 1) AS admissions,
      i.line_total_inr,
      o.payment_status IN ('paid', 'completed') AS is_paid,
      CASE WHEN jsonb_typeof(i.selected_time_slots) = 'array'
        THEN i.selected_time_slots ELSE '[]'::JSONB END AS slots,
      CASE i.package_key
        WHEN 'one-intensive' THEN 1
        WHEN 'two-intensives' THEN 2
        WHEN 'four-intensives' THEN 4
        WHEN 'four-intensives-party' THEN 4
        WHEN 'six-pax-four-intensives-party' THEN 4
        WHEN 'ten-pax-four-intensives-party' THEN 4
        WHEN 'party-entry' THEN 0
        ELSE NULL
      END AS expected_slots
    FROM public.event_order_items i
    JOIN public.event_orders o ON o.id = i.order_id
    WHERE i.package_category IN ('intensives', 'party', 'package', 'group')
      -- Same status/expiry predicates as checkout; do not call mutation-capable status RPCs.
      AND (o.payment_status IN ('paid', 'completed') OR (
        o.payment_status IN ('pending', 'manual_payment')
        AND COALESCE(o.checkout_token_expires_at, o.created_at + INTERVAL '15 minutes') > now()
      ))
  ), session_counts AS (
    SELECT s.session_number, s.slot_label AS label, s.seat_cap AS capacity,
      COALESCE(SUM(i.admissions) FILTER (WHERE i.is_paid), 0) AS sold,
      COALESCE(SUM(i.admissions) FILTER (WHERE NOT i.is_paid), 0) AS on_hold
    FROM public.event_sessions s
    LEFT JOIN event_items i ON i.slots ? s.slot_label
    GROUP BY s.session_number, s.slot_label, s.seat_cap
  ), party_counts AS (
    SELECT COALESCE(SUM(admissions) FILTER (WHERE is_paid), 0) AS sold,
      COALESCE(SUM(admissions) FILTER (WHERE NOT is_paid), 0) AS on_hold
    FROM event_items WHERE package_category IN ('party', 'package', 'group')
  ), totals AS (
    -- Aggregate line revenue before expanding items into their included sessions.
    SELECT COUNT(DISTINCT order_id) FILTER (WHERE is_paid) AS paid_orders,
      COALESCE(SUM(line_total_inr) FILTER (WHERE is_paid), 0) AS event_revenue_inr
    FROM event_items
  ), quality AS (
    SELECT COUNT(*) FILTER (WHERE
      (i.expected_slots IS NOT NULL AND i.expected_slots <> (
        SELECT COUNT(*) FROM public.event_sessions s WHERE i.slots ? s.slot_label
      ))
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(i.slots) slot
        WHERE jsonb_typeof(slot) <> 'string' OR NOT EXISTS (
          SELECT 1 FROM public.event_sessions s WHERE to_jsonb(s.slot_label) = slot
        )
      )
      OR jsonb_array_length(i.slots) <> (SELECT COUNT(DISTINCT slot) FROM jsonb_array_elements(i.slots) slot)
    ) AS session_assignment_items,
    COUNT(*) FILTER (WHERE i.expected_slots IS NULL) AS unknown_package_items,
    COUNT(*) FILTER (WHERE
      (i.package_key = 'six-pax-four-intensives-party' AND i.pax IS DISTINCT FROM 6)
      OR (i.package_key = 'ten-pax-four-intensives-party' AND i.pax IS DISTINCT FROM 10)
      OR (i.package_category = 'group' AND i.pax IS NULL)
    ) AS pax_items
    FROM event_items i
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'sessions', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'session_number', session_number, 'label', label,
      'sold', sold, 'on_hold', on_hold, 'capacity', capacity,
      'available', GREATEST(capacity - sold - on_hold, 0)
    ) ORDER BY session_number), '[]'::JSONB) FROM session_counts),
    'party', jsonb_build_object('sold', p.sold, 'on_hold', p.on_hold),
    'totals', jsonb_build_object(
      'intensive_admissions', (SELECT COALESCE(SUM(sold), 0) FROM session_counts),
      'party_admissions', p.sold,
      'total_admissions', (SELECT COALESCE(SUM(sold), 0) FROM session_counts) + p.sold,
      'paid_orders', t.paid_orders, 'event_revenue_inr', t.event_revenue_inr
    ),
    'warnings', jsonb_build_object(
      'session_assignment_items', q.session_assignment_items,
      'unknown_package_items', q.unknown_package_items,
      'pax_items', q.pax_items,
      'incomplete_session_catalog', (SELECT COUNT(*) <> 4 FROM public.event_sessions)
    )
  ) INTO v_report FROM party_counts p CROSS JOIN totals t CROSS JOIN quality q;

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_live_sales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_live_sales() TO authenticated;
COMMENT ON FUNCTION public.get_event_live_sales() IS
  'Admin-only read-only event admissions and INR revenue. Coin items excluded; paid sales and live holds kept separate.';
