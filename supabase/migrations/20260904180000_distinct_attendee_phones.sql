-- Wristbands are party entries; every wristband needs its own phone number.
-- The phone is what links a person to their band for top-ups and for the
-- attendee-row freeze, so two rows sharing a number would break both.

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
  v_digits TEXT;
  v_seen INTEGER[] := ARRAY[]::INTEGER[];
  v_phones TEXT[] := ARRAY[]::TEXT[];
  v_existing public.event_order_attendees;
  v_clash public.event_order_attendees;
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
    v_digits := public.normalize_phone_digits(v_phone);

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

    -- One phone per wristband, within this submission…
    IF v_digits = ANY (v_phones) THEN
      RAISE EXCEPTION 'Wristband % uses the same phone as another wristband — each person needs their own number', v_position;
    END IF;
    v_phones := array_append(v_phones, v_digits);

    -- …and against rows already saved at other positions.
    SELECT * INTO v_clash
    FROM public.event_order_attendees
    WHERE order_id = v_order.id
      AND position <> v_position
      AND public.normalize_phone_digits(attendee_phone) = v_digits
    LIMIT 1;

    IF v_clash.id IS NOT NULL AND NOT (v_clash.position = ANY (v_seen)) THEN
      RAISE EXCEPTION 'Wristband % uses the same phone as wristband % (%) — each person needs their own number',
        v_position, v_clash.position, v_clash.attendee_name;
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

-- Gate: tell staff when a phone already has a band on this booking.
CREATE OR REPLACE FUNCTION public.phone_has_band_on_order(p_parent_order_id UUID, p_phone TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT jsonb_build_object('has_band', true, 'attendee_name', w.attendee_name, 'band_hint', right(w.tag_id, 3))
     FROM public.wallets w
     WHERE w.event_order_id = p_parent_order_id
       AND w.status = 'active'
       AND length(public.normalize_phone_digits(p_phone)) = 10
       AND public.normalize_phone_digits(w.attendee_phone) = public.normalize_phone_digits(p_phone)
     ORDER BY w.created_at
     LIMIT 1),
    jsonb_build_object('has_band', false)
  );
$$;

REVOKE ALL ON FUNCTION public.phone_has_band_on_order(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_has_band_on_order(UUID, TEXT) TO authenticated;
