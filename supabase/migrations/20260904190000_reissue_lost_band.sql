-- Lost or broken band: block the old one, issue a new one to the same person,
-- move the balance across in one transaction. Needed once bands go out early
-- (issued at the intensives on 9–10 Sep) and a band can be lost before Friday.

CREATE OR REPLACE FUNCTION public.staff_list_bands_for_order(p_parent_order_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE COALESCE(
    (SELECT jsonb_agg(jsonb_build_object(
        'wallet_id', w.id,
        'attendee_name', w.attendee_name,
        'attendee_phone', w.attendee_phone,
        'tag_id', w.tag_id,
        'band_hint', right(w.tag_id, 3),
        'coin_balance', COALESCE(w.coin_balance, 0),
        'status', w.status,
        'created_at', w.created_at
      ) ORDER BY w.created_at)
     FROM public.wallets w
     WHERE w.event_order_id = p_parent_order_id),
    '[]'::jsonb) END;
$$;

REVOKE ALL ON FUNCTION public.staff_list_bands_for_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_list_bands_for_order(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.reissue_wallet(
  p_old_wallet_id UUID,
  p_new_tag_id TEXT,
  p_reason TEXT DEFAULT 'lost'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.wallets;
  v_new_id UUID;
  v_balance INTEGER;
  v_tag TEXT := upper(trim(coalesce(p_new_tag_id, '')));
  v_staff UUID;
  v_old_hint TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as staff to reissue a band';
  END IF;

  IF length(v_tag) < 4 THEN
    RAISE EXCEPTION 'Scan the new band first';
  END IF;

  SELECT * INTO v_old FROM public.wallets WHERE id = p_old_wallet_id FOR UPDATE;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'Band not found';
  END IF;

  IF v_old.tag_id = v_tag THEN
    RAISE EXCEPTION 'That is the same band';
  END IF;

  IF EXISTS (SELECT 1 FROM public.wallets WHERE tag_id = v_tag) THEN
    RAISE EXCEPTION 'The new band is already registered to someone';
  END IF;

  SELECT profiles.id INTO v_staff FROM public.profiles WHERE profiles.id = auth.uid();

  v_balance := GREATEST(COALESCE(v_old.coin_balance, 0), 0);
  v_old_hint := right(v_old.tag_id, 3);

  INSERT INTO public.wallets (tag_id, attendee_name, attendee_phone, studio, balance, coin_balance, status, event_order_id)
  VALUES (v_tag, v_old.attendee_name, v_old.attendee_phone, v_old.studio, v_balance, v_balance, 'active', v_old.event_order_id)
  RETURNING id INTO v_new_id;

  UPDATE public.wallets
  SET coin_balance = 0, balance = 0, status = 'blocked'
  WHERE id = v_old.id;

  IF v_balance > 0 THEN
    INSERT INTO public.transactions (wallet_id, type, amount, inr_amount, coin_amount, description, reference, staff_user_id)
    VALUES
      (v_old.id, 'spend', -v_balance, 0, -v_balance,
       'Band ' || coalesce(p_reason, 'lost') || ' · balance moved to band ···' || right(v_tag, 3), 'reissue:' || v_new_id::TEXT, v_staff),
      (v_new_id, 'load', v_balance, 0, v_balance,
       'Balance moved from ' || coalesce(p_reason, 'lost') || ' band ···' || v_old_hint, 'reissue:' || v_old.id::TEXT, v_staff);
  END IF;

  RETURN jsonb_build_object(
    'old_wallet_id', v_old.id,
    'new_wallet_id', v_new_id,
    'new_tag_id', v_tag,
    'moved_coins', v_balance,
    'attendee_name', v_old.attendee_name,
    'event_order_id', v_old.event_order_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reissue_wallet(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reissue_wallet(UUID, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.reissue_wallet(UUID, TEXT, TEXT) IS 'Blocks a lost/broken band, creates a replacement for the same person on the same booking, and moves the full coin balance across. Online top-ups follow the person because the new band carries the same event_order_id and phone.';
