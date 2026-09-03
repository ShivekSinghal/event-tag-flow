-- Pink'd attendee names (per the organisers' 4 Sep requirement):
--   Crew passes (6 or 10 people) and any checkout with more than one party entry
--   must collect one name + phone per entry. Each name is one wristband at the gate.
--   Names are collected AFTER payment on /attendees?ref=XXXXXXXX (linked from the
--   confirmation email and confirmation panel), never during checkout.
--
--   lookup_order_attendee_slots()  → what the form needs to render (or NULL).
--   submit_order_attendees()       → upserts names by (order_id, position).
--   Both reuse find_paid_party_order() as the gate, like /coins does.

-- ---------------------------------------------------------------------------
-- 1. One row per wristband
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.event_order_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.event_orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  attendee_name TEXT NOT NULL CHECK (length(trim(attendee_name)) > 0),
  attendee_phone TEXT NOT NULL CHECK (length(trim(attendee_phone)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT event_order_attendees_order_position_key UNIQUE (order_id, position)
);

CREATE INDEX IF NOT EXISTS event_order_attendees_order_id_idx ON public.event_order_attendees (order_id);

ALTER TABLE public.event_order_attendees ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.event_order_attendees FROM anon, authenticated;
GRANT SELECT ON public.event_order_attendees TO authenticated;

DROP POLICY IF EXISTS "Admins can view event order attendees" ON public.event_order_attendees;

CREATE POLICY "Admins can view event order attendees"
ON public.event_order_attendees
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

DROP TRIGGER IF EXISTS update_event_order_attendees_updated_at ON public.event_order_attendees;
CREATE TRIGGER update_event_order_attendees_updated_at
  BEFORE UPDATE ON public.event_order_attendees
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2. Shared payload builder (internal; not callable by anon)
-- ---------------------------------------------------------------------------

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
BEGIN
  IF p_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)), 0)::INTEGER,
    COALESCE(bool_or(items.package_category = 'group'), false),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'package_name', items.package_name,
          'quantity', items.quantity,
          'pax', items.pax
        )
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
        'attendee_phone', attendees.attendee_phone
      )
      ORDER BY attendees.position
    ),
    '[]'::jsonb
  )
  INTO v_attendees
  FROM public.event_order_attendees attendees
  WHERE attendees.order_id = p_order.id;

  RETURN jsonb_build_object(
    'order_id', p_order.id,
    'order_ref', upper(left(p_order.id::TEXT, 8)),
    'booker_name', trim(p_order.customer_name),
    'booker_phone', trim(p_order.customer_phone),
    'party_entries', v_party_entries,
    'requires_form', (v_party_entries > 1 OR v_has_group),
    'items', v_items,
    'attendees', v_attendees
  );
END;
$$;

REVOKE ALL ON FUNCTION public.event_order_attendee_slots_payload(public.event_orders) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Lookup: what /attendees needs to render
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lookup_order_attendee_slots(p_order_ref TEXT, p_contact TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
BEGIN
  v_order := public.find_paid_party_order(p_order_ref, p_contact);

  IF v_order.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.event_order_attendee_slots_payload(v_order);
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_order_attendee_slots(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_order_attendee_slots(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Submit: upsert one name + phone per wristband position
-- ---------------------------------------------------------------------------

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
BEGIN
  v_order := public.find_paid_party_order(p_order_ref, p_contact);

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'We could not find a paid party ticket for that order';
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

  -- One order at a time so two tabs cannot interleave their upserts.
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

    INSERT INTO public.event_order_attendees (order_id, position, attendee_name, attendee_phone)
    VALUES (v_order.id, v_position, v_name, v_phone)
    ON CONFLICT (order_id, position) DO UPDATE
    SET
      attendee_name = EXCLUDED.attendee_name,
      attendee_phone = EXCLUDED.attendee_phone,
      updated_at = now();
  END LOOP;

  RETURN public.event_order_attendee_slots_payload(v_order);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_order_attendees(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_order_attendees(TEXT, TEXT, JSONB) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.event_order_attendees IS 'Pink''d attendee names collected after payment on /attendees. One row per wristband (order_id, position); crews and multi-entry orders must fill these in.';
COMMENT ON FUNCTION public.event_order_attendee_slots_payload(public.event_orders) IS 'Internal: builds the /attendees payload (entries, items, saved names) for a paid party order.';
COMMENT ON FUNCTION public.lookup_order_attendee_slots(TEXT, TEXT) IS 'Gate for /attendees: returns the attendee form payload for a paid party-ticket order matched by order ref or booking email/phone, or NULL.';
COMMENT ON FUNCTION public.submit_order_attendees(TEXT, TEXT, JSONB) IS 'Upserts one name + phone per wristband position for a paid Pink''d party order. Partial lists are allowed; positions are 1..party_entries.';
