-- Check-in is separate from payment, capacity reservations and NFC wallet activity.
CREATE TABLE public.event_admission_checkins (
  item_id uuid NOT NULL REFERENCES public.event_order_items(id),
  admission_index integer NOT NULL CHECK (admission_index > 0),
  event_number integer NOT NULL CHECK (event_number BETWEEN 0 AND 4),
  attendee_name text NOT NULL CHECK (length(trim(attendee_name)) BETWEEN 1 AND 120),
  attendee_phone text NOT NULL CHECK (length(trim(attendee_phone)) BETWEEN 1 AND 40),
  checked_in_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  checked_in_by uuid REFERENCES public.profiles(id),
  undone_at timestamptz,
  undone_by uuid REFERENCES public.profiles(id),
  PRIMARY KEY (item_id, admission_index, event_number)
);
ALTER TABLE public.event_admission_checkins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_admission_checkins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_admission_checkins TO authenticated;
CREATE POLICY admission_checkins_admin_read ON public.event_admission_checkins
FOR SELECT TO authenticated USING (public.get_current_user_role() = 'admin');
CREATE INDEX event_admission_checkins_operator_idx ON public.event_admission_checkins(checked_in_by);
CREATE INDEX event_admission_checkins_undo_operator_idx ON public.event_admission_checkins(undone_by);

-- Stable identity is the purchased line + seat index + event, never a guest name.
-- Attendee positions belong to party-bearing lines only. Intensive-only lines must
-- not accidentally inherit names from a separate party item in the same order.
CREATE VIEW public.event_admission_roster WITH (security_invoker = true) AS
WITH lines AS (
  SELECT i.*, o.customer_name, o.customer_phone, o.customer_email, o.customer_studio,
    o.payment_status, o.payment_provider,
    i.quantity * coalesce(i.pax, 1) AS admissions,
    sum(i.quantity * coalesce(i.pax, 1)) OVER (PARTITION BY i.order_id) AS order_tickets,
    coalesce(sum(CASE WHEN i.package_category IN ('party','package','group')
      THEN i.quantity * coalesce(i.pax, 1) ELSE 0 END)
      OVER (PARTITION BY i.order_id ORDER BY i.created_at, i.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS party_offset
  FROM public.event_order_items i JOIN public.event_orders o ON o.id = i.order_id
  WHERE auth.uid() IS NOT NULL AND public.get_current_user_role() = 'admin'
    AND o.payment_status IN ('paid','completed')
    AND i.package_category IN ('intensives','party','package','group')
), events AS (
  SELECT 0 AS event_number, 'Party'::text AS label
  UNION ALL SELECT session_number, slot_label FROM public.event_sessions
)
SELECT l.id AS item_id, n.admission_index, e.event_number, e.label,
  l.order_id, upper(left(l.order_id::text, 8)) AS order_ref, l.package_name,
  coalesce(nullif(trim(l.customer_studio), ''), 'Not specified') AS studio,
  l.customer_name AS booker_name, l.customer_phone AS booker_phone, l.customer_email AS booker_email,
  l.payment_status, l.payment_provider,
  coalesce(c.attendee_name, a.attendee_name, CASE WHEN l.order_tickets = 1 THEN nullif(trim(l.customer_name), '') END) AS attendee_name,
  coalesce(c.attendee_phone, a.attendee_phone, CASE WHEN l.order_tickets = 1 THEN nullif(trim(l.customer_phone), '') END) AS attendee_phone,
  CASE WHEN c.undone_at IS NULL THEN c.checked_in_at END AS checked_in_at,
  CASE WHEN c.undone_at IS NULL THEN p.full_name END AS checked_in_by
FROM lines l
CROSS JOIN LATERAL generate_series(1, l.admissions) n(admission_index)
JOIN events e ON (e.event_number = 0 AND l.package_category IN ('party','package','group'))
  OR (e.event_number > 0 AND CASE WHEN jsonb_typeof(l.selected_time_slots) = 'array'
    THEN l.selected_time_slots ELSE '[]'::jsonb END ? e.label)
LEFT JOIN public.event_order_attendees a ON a.order_id = l.order_id
  AND l.package_category IN ('party','package','group')
  AND a.position = l.party_offset + n.admission_index
LEFT JOIN public.event_admission_checkins c ON c.item_id = l.id
  AND c.admission_index = n.admission_index AND c.event_number = e.event_number
LEFT JOIN public.profiles p ON p.id = c.checked_in_by;
REVOKE ALL ON public.event_admission_roster FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.event_admission_roster TO authenticated;

CREATE FUNCTION public.get_event_admission_report(p_event_number integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.get_current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_event_number IS NOT NULL AND p_event_number NOT BETWEEN 0 AND 4 THEN
    RAISE EXCEPTION 'Invalid event';
  END IF;
  WITH roster AS MATERIALIZED (SELECT * FROM public.event_admission_roster),
  studios AS (SELECT studio, event_number, count(*) AS sold,
    count(checked_in_at) AS checked_in FROM roster GROUP BY studio, event_number)
  SELECT jsonb_build_object('generated_at', now(),
    'studios', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY studio, event_number), '[]'::jsonb) FROM studios s),
    'attendees', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY studio, coalesce(attendee_name, booker_name), order_id, item_id, admission_index), '[]'::jsonb)
      FROM roster r WHERE event_number = p_event_number)) INTO v_result;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_event_admission_report(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_admission_report(integer) TO authenticated;

CREATE FUNCTION public.set_event_admission_checkin(
  p_item_id uuid, p_admission_index integer, p_event_number integer,
  p_checked_in boolean, p_expected_checked_in_at timestamptz DEFAULT NULL,
  p_attendee_name text DEFAULT NULL, p_attendee_phone text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_guest record; v_order_id uuid; v_row public.event_admission_checkins;
  v_name text; v_phone text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; END IF;
  IF p_checked_in IS NULL OR p_admission_index IS NULL OR p_admission_index < 1
    OR p_event_number IS NULL OR p_event_number NOT BETWEEN 0 AND 4 THEN
    RAISE EXCEPTION 'Invalid admission';
  END IF;
  SELECT order_id INTO v_order_id FROM public.event_order_items WHERE id = p_item_id;
  -- Serialize check-ins for an order and payment-status transitions before validation.
  PERFORM 1 FROM public.event_orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO v_guest FROM public.event_admission_roster
    WHERE item_id = p_item_id AND admission_index = p_admission_index AND event_number = p_event_number;
  IF NOT FOUND THEN RAISE EXCEPTION 'No paid admission for this event'; END IF;

  IF p_checked_in THEN
    v_name := coalesce(nullif(trim(v_guest.attendee_name), ''), nullif(trim(p_attendee_name), ''));
    v_phone := coalesce(nullif(trim(v_guest.attendee_phone), ''), nullif(trim(p_attendee_phone), ''));
    IF v_name IS NULL OR length(v_name) > 120 OR v_phone IS NULL OR length(v_phone) > 40
      OR length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 10 THEN
      RAISE EXCEPTION 'Guest name and valid phone are required';
    END IF;
    INSERT INTO public.event_admission_checkins AS c
      (item_id, admission_index, event_number, attendee_name, attendee_phone, checked_in_by)
    VALUES (p_item_id, p_admission_index, p_event_number, v_name, v_phone, auth.uid())
    ON CONFLICT (item_id, admission_index, event_number) DO UPDATE SET
      checked_in_at = clock_timestamp(), checked_in_by = auth.uid(), undone_at = NULL, undone_by = NULL,
      attendee_name = excluded.attendee_name, attendee_phone = excluded.attendee_phone
    WHERE c.undone_at IS NOT NULL;
  ELSE
    SELECT * INTO v_row FROM public.event_admission_checkins
      WHERE item_id = p_item_id AND admission_index = p_admission_index AND event_number = p_event_number;
    IF v_row.checked_in_at IS NOT NULL AND v_row.undone_at IS NULL THEN
      IF p_expected_checked_in_at IS DISTINCT FROM v_row.checked_in_at THEN
        RAISE EXCEPTION 'Check-in changed on another device. Refresh before undoing.';
      END IF;
      UPDATE public.event_admission_checkins SET undone_at = clock_timestamp(), undone_by = auth.uid()
        WHERE item_id = p_item_id AND admission_index = p_admission_index AND event_number = p_event_number;
    END IF;
  END IF;
  SELECT * INTO v_guest FROM public.event_admission_roster
    WHERE item_id = p_item_id AND admission_index = p_admission_index AND event_number = p_event_number;
  RETURN to_jsonb(v_guest);
END $$;
REVOKE ALL ON FUNCTION public.set_event_admission_checkin(uuid, integer, integer, boolean, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_event_admission_checkin(uuid, integer, integer, boolean, timestamptz, text, text) TO authenticated;
