-- Attendee rows freeze once a band has been issued against them (phone match
-- with a wallet linked to the booking). Unissued rows stay editable until the
-- gate; everything locks after the event. Staff can still correct wallets on
-- the admin side.

CREATE OR REPLACE FUNCTION public.event_attendee_form_locked_at()
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '2026-09-12 06:00:00+05:30'::TIMESTAMPTZ;  -- morning after the party
$$;

CREATE OR REPLACE FUNCTION public.event_order_attendee_slots_payload(p_order public.event_orders)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_party_entries INTEGER;
  v_has_group BOOLEAN;
  v_items JSONB;
  v_attendees JSONB;
  v_event_locked BOOLEAN := now() >= public.event_attendee_form_locked_at();
BEGIN
  IF p_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)), 0)::INTEGER,
    COALESCE(bool_or(items.package_category = 'group'), false),
    COALESCE(
      jsonb_agg(
        jsonb_build_object('package_name', items.package_name, 'quantity', items.quantity, 'pax', items.pax)
        ORDER BY items.created_at, items.id
      ),
      '[]'::jsonb
    )
  INTO v_party_entries, v_has_group, v_items
  FROM public.event_order_items items
  WHERE items.order_id = p_order.id
    AND items.package_category IN ('party', 'package', 'group');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'position', attendees.position,
        'attendee_name', attendees.attendee_name,
        'attendee_phone', attendees.attendee_phone,
        'issued', issued.id IS NOT NULL,
        'band_hint', CASE WHEN issued.id IS NULL THEN NULL ELSE right(issued.tag_id, 3) END,
        'locked', v_event_locked OR issued.id IS NOT NULL
      )
      ORDER BY attendees.position
    ),
    '[]'::jsonb
  )
  INTO v_attendees
  FROM public.event_order_attendees attendees
  LEFT JOIN LATERAL (
    SELECT w.id, w.tag_id
    FROM public.wallets w
    WHERE w.event_order_id = p_order.id
      AND w.status = 'active'
      AND public.normalize_phone_digits(w.attendee_phone) = public.normalize_phone_digits(attendees.attendee_phone)
      AND length(public.normalize_phone_digits(attendees.attendee_phone)) = 10
    ORDER BY w.created_at
    LIMIT 1
  ) issued ON true
  WHERE attendees.order_id = p_order.id;

  RETURN jsonb_build_object(
    'order_id', p_order.id,
    'order_ref', upper(left(p_order.id::TEXT, 8)),
    'booker_name', trim(p_order.customer_name),
    'booker_phone', trim(p_order.customer_phone),
    'party_entries', v_party_entries,
    'requires_form', (v_party_entries > 1 OR v_has_group),
    'event_locked', v_event_locked,
    'items', v_items,
    'attendees', v_attendees
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_order_attendees(p_order_ref TEXT, p_contact TEXT, p_attendees JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
  v_party_entries INTEGER;
  v_item JSONB;
  v_position INTEGER;
  v_name TEXT;
  v_phone TEXT;
  v_seen INTEGER[] := ARRAY[]::INTEGER[];
  v_existing public.event_order_attendees;
  v_issued BOOLEAN;
BEGIN
  v_order := public.find_paid_party_order(p_order_ref, p_contact);

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'We could not find a paid party ticket for that order';
  END IF;

  IF now() >= public.event_attendee_form_locked_at() THEN
    RAISE EXCEPTION 'The attendee list is closed now that the event is over';
  END IF;

  SELECT COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)), 0)::INTEGER
  INTO v_party_entries
  FROM public.event_order_items items
  WHERE items.order_id = v_order.id
    AND items.package_category IN ('party', 'package', 'group');

  IF v_party_entries < 1 THEN
    RAISE EXCEPTION 'We could not find a paid party ticket for that order';
  END IF;

  IF p_attendees IS NULL OR jsonb_typeof(p_attendees) <> 'array' OR jsonb_array_length(p_attendees) = 0 THEN
    RAISE EXCEPTION 'Add at least one attendee';
  END IF;

  IF jsonb_array_length(p_attendees) > v_party_entries THEN
    RAISE EXCEPTION 'This order has % wristband(s); you sent % names', v_party_entries, jsonb_array_length(p_attendees);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('pinkd_attendees_' || v_order.id::text));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_attendees)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Invalid attendee entry';
    END IF;

    BEGIN
      v_position := NULLIF(trim(v_item ->> 'position'), '')::INTEGER;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid attendee position';
    END;

    IF v_position IS NULL OR v_position < 1 OR v_position > v_party_entries THEN
      RAISE EXCEPTION 'Attendee position must be between 1 and %', v_party_entries;
    END IF;

    IF v_position = ANY (v_seen) THEN
      RAISE EXCEPTION 'Attendee position % was sent more than once', v_position;
    END IF;
    v_seen := array_append(v_seen, v_position);

    v_name := trim(coalesce(v_item ->> 'attendee_name', ''));
    v_phone := trim(coalesce(v_item ->> 'attendee_phone', ''));

    IF length(v_name) = 0 THEN
      RAISE EXCEPTION 'Name is required for wristband %', v_position;
    END IF;
    IF length(v_phone) = 0 THEN
      RAISE EXCEPTION 'Phone is required for wristband %', v_position;
    END IF;
    IF length(regexp_replace(v_phone, '\D', '', 'g')) < 10 THEN
      RAISE EXCEPTION 'Phone for wristband % needs at least 10 digits', v_position;
    END IF;
    IF length(v_name) > 120 OR length(v_phone) > 40 THEN
      RAISE EXCEPTION 'Name or phone for wristband % is too long', v_position;
    END IF;

    -- A row whose phone already has a band issued against it is frozen.
    SELECT * INTO v_existing
    FROM public.event_order_attendees
    WHERE order_id = v_order.id AND position = v_position;

    IF v_existing.id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.wallets w
        WHERE w.event_order_id = v_order.id
          AND w.status = 'active'
          AND length(public.normalize_phone_digits(v_existing.attendee_phone)) = 10
          AND public.normalize_phone_digits(w.attendee_phone) = public.normalize_phone_digits(v_existing.attendee_phone)
      ) INTO v_issued;

      IF v_issued AND (v_existing.attendee_name <> v_name OR v_existing.attendee_phone <> v_phone) THEN
        RAISE EXCEPTION 'Wristband % has already been issued to % and can''t be changed here — ask the team at the gate',
          v_position, v_existing.attendee_name;
      END IF;
    END IF;

    INSERT INTO public.event_order_attendees (order_id, position, attendee_name, attendee_phone)
    VALUES (v_order.id, v_position, v_name, v_phone)
    ON CONFLICT (order_id, position) DO UPDATE
    SET attendee_name = EXCLUDED.attendee_name,
        attendee_phone = EXCLUDED.attendee_phone,
        updated_at = now();
  END LOOP;

  RETURN public.event_order_attendee_slots_payload(v_order);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_order_attendees(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_order_attendees(TEXT, TEXT, JSONB) TO anon, authenticated;
