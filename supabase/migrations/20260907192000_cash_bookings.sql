-- Cash at the studio counter (decided 7 Sep 2026, Ayushi + Manas).
--
-- The student books on the public checkout exactly as online and picks "Pay cash at the studio".
-- The order is the same manual_payment hold as online checkout (so the phase meter and seat
-- caps count it) but for 5 minutes instead of 15 — the student is standing at the counter.
-- The studio manager takes the cash and asks for a confirmation code, which is emailed to the
-- student (cash-booking edge function). Entering the code marks the order paid, which fires
-- the normal confirmation email. Additive: one table, three functions; nothing existing changes.

-- 'cash' joins the allowed payment providers.
ALTER TABLE public.event_orders DROP CONSTRAINT IF EXISTS event_orders_payment_provider_check;
ALTER TABLE public.event_orders
  ADD CONSTRAINT event_orders_payment_provider_check
  CHECK (payment_provider IN ('manual', 'cashfree', 'razorpay', 'cash'));

CREATE TABLE IF NOT EXISTS public.cash_booking_confirmations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL UNIQUE REFERENCES public.event_orders(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL,
  sent_to       TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  resends       INTEGER NOT NULL DEFAULT 0,
  requested_by  UUID NOT NULL,
  requested_by_label TEXT,
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cash_booking_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cash_booking_confirmations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cash_booking_confirmations TO service_role;
COMMENT ON TABLE public.cash_booking_confirmations IS
  'One row per cash order once a manager requests the code: the hashed 6-digit code emailed to the student, who requested it, and when it was confirmed. Only the cash-booking edge function touches it.';

-- Called by the public checkout right after create_event_order_checkout when the student chose
-- cash. Proves ownership with the same checkout token the payment functions use.
CREATE OR REPLACE FUNCTION public.mark_event_order_cash_at_counter(
  p_order_id UUID,
  p_checkout_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
BEGIN
  SELECT * INTO v_order FROM public.event_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF v_order.checkout_token_hash IS DISTINCT FROM lower(trim(coalesce(p_checkout_token_hash, ''))) THEN
    RAISE EXCEPTION 'Checkout session mismatch';
  END IF;
  IF v_order.payment_status NOT IN ('pending', 'manual_payment') THEN
    RAISE EXCEPTION 'This order is already %', v_order.payment_status;
  END IF;
  IF v_order.booking_source <> 'landing_page' THEN
    RAISE EXCEPTION 'Only ticket and intensive bookings can be paid in cash';
  END IF;

  UPDATE public.event_orders
  SET payment_provider = 'cash',
      payment_status = 'manual_payment',
      payment_reference = 'CASH · awaiting counter',
      checkout_token_expires_at = now() + interval '5 minutes',
      attribution = coalesce(attribution, '{}'::jsonb) || jsonb_build_object('payment_choice', 'cash_at_studio')
  WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_ref', upper(left(v_order.id::text, 8)),
    'total_amount_inr', v_order.total_amount_inr,
    'hold_expires_at', now() + interval '5 minutes'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mark_event_order_cash_at_counter(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_event_order_cash_at_counter(UUID, TEXT) TO anon, authenticated, service_role;

-- The Cash desk: cash orders from the last 45 minutes (studio managers + admins).
-- Includes expired holds so a student who queued too long can be revived at the counter.
CREATE OR REPLACE FUNCTION public.list_cash_desk_orders(p_studio TEXT DEFAULT NULL)
RETURNS TABLE(
  order_id UUID, order_ref TEXT, customer_name TEXT, customer_phone_hint TEXT, customer_email TEXT,
  customer_studio TEXT, total_amount_inr NUMERIC, payment_status TEXT, items TEXT,
  hold_expires_at TIMESTAMPTZ, hold_live BOOLEAN, code_sent BOOLEAN, confirmed_at TIMESTAMPTZ,
  requested_by TEXT, created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.id, upper(left(o.id::text, 8)), o.customer_name, '···' || right(regexp_replace(o.customer_phone, '\D', '', 'g'), 4),
         o.customer_email, o.customer_studio, o.total_amount_inr, o.payment_status,
         (SELECT string_agg(i.package_name || CASE WHEN i.quantity > 1 THEN ' ×' || i.quantity ELSE '' END, ', ' ORDER BY i.created_at)
            FROM public.event_order_items i WHERE i.order_id = o.id),
         o.checkout_token_expires_at,
         public.event_order_hold_is_live(o.payment_status, o.checkout_token_expires_at, o.created_at),
         c.id IS NOT NULL, c.confirmed_at, c.requested_by_label, o.created_at
  FROM public.event_orders o
  LEFT JOIN public.cash_booking_confirmations c ON c.order_id = o.id
  WHERE o.payment_provider = 'cash'
    AND o.created_at > now() - interval '45 minutes'
    AND o.payment_status <> 'cancelled'
    AND (p_studio IS NULL OR p_studio = '' OR o.customer_studio = p_studio)
    AND public.get_current_user_role() IN ('admin', 'studio_manager')
  ORDER BY (public.event_order_is_paid(o.payment_status)) ASC, o.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.list_cash_desk_orders(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_cash_desk_orders(TEXT) TO authenticated;

-- Revive an expired cash hold (student queued too long): allowed within 45 minutes of booking
-- if the party phase price hasn't moved and the chosen sessions still have seats.
CREATE OR REPLACE FUNCTION public.revive_cash_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
  v_item RECORD;
  v_phase public.event_pricing_phases;
  v_seat RECORD;
  v_slot TEXT;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR public.get_current_user_role() NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Sign in as a studio manager';
  END IF;
  SELECT * INTO v_order FROM public.event_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL OR v_order.payment_provider <> 'cash' THEN
    RAISE EXCEPTION 'Cash order not found';
  END IF;
  IF public.event_order_is_paid(v_order.payment_status) THEN
    RETURN jsonb_build_object('revived', false, 'reason', 'already_paid');
  END IF;
  IF v_order.created_at < now() - interval '45 minutes' THEN
    RAISE EXCEPTION 'Too old to revive — ask the student to book again';
  END IF;

  -- Party items must still be at the price the student saw.
  v_phase := public.resolve_party_phase(true);
  FOR v_item IN SELECT * FROM public.event_order_items WHERE order_id = v_order.id AND package_category = 'party' LOOP
    IF v_item.unit_price_inr <> v_phase.price_inr THEN
      RAISE EXCEPTION 'Party price moved to % since this was booked — ask the student to book again', v_phase.price_inr;
    END IF;
  END LOOP;

  -- Chosen sessions must still have a seat (this order's own hold is already expired, so it isn't counted).
  FOR v_item IN SELECT * FROM public.event_order_items WHERE order_id = v_order.id AND jsonb_typeof(selected_time_slots) = 'array' LOOP
    FOR v_slot IN SELECT jsonb_array_elements_text(v_item.selected_time_slots) LOOP
      SELECT * INTO v_seat FROM public.get_session_seat_counts() s WHERE s.slot_label = v_slot;
      IF v_seat.slot_label IS NOT NULL AND v_seat.booked + v_seat.held + (v_item.quantity * coalesce(v_item.pax, 1)) > v_seat.seat_cap THEN
        RAISE EXCEPTION '% is now full — ask the student to pick another session', v_slot;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.event_orders
  SET payment_status = 'manual_payment',
      checkout_token_expires_at = now() + interval '5 minutes'
  WHERE id = v_order.id;

  RETURN jsonb_build_object('revived', true, 'hold_expires_at', now() + interval '5 minutes');
END;
$$;
REVOKE ALL ON FUNCTION public.revive_cash_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revive_cash_order(UUID) TO authenticated;
