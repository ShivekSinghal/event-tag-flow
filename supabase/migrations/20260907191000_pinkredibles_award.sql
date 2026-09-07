-- Pinkredibles (Sep 2026 edition) — trimmed to the model decided 7 Sep:
--   charge for the game exactly as today (tap → spend_wallet_coins), then a SEPARATE
--   "Award Pinkredible" action gives the winner one reward ticket on their band.
--   No pay-into-round mechanic. Redeemed at registration via a PINK-XXXXXX code (₹100 each),
--   valid until end of 11 Oct 2026 IST. Reissue carries Pinkredibles and the code across bands.
-- Lifted from branch pinkd/pinkredibles (6 Sep) minus game_rounds. Additive only.

-- Which games hand a Pinkredible to the winner (Tier 2 and Tier 3 in the 5 Sep SOP). Admin can flip this in the games table.
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS awards_pinkredible BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.games.awards_pinkredible IS 'Whether the POS offers "Award Pinkredible" for this game (winner gets one).';
UPDATE public.games SET awards_pinkredible = true
WHERE name IN ('Hurdles', 'Cricket', 'Issue with the Tissue', 'Limbo', 'Minute to Win It', 'Bombastic');

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS pinkredible_balance INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pinkredible_code TEXT;

ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_pinkredible_balance_nonnegative;
ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_pinkredible_balance_nonnegative CHECK (pinkredible_balance >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS wallets_pinkredible_code_key
  ON public.wallets (pinkredible_code) WHERE pinkredible_code IS NOT NULL;

COMMENT ON COLUMN public.wallets.pinkredible_balance IS
  'Pinkredibles (reward tickets, ₹100 each) currently on this band. Won at the game stalls, redeemed at course registration.';
COMMENT ON COLUMN public.wallets.pinkredible_code IS
  'Coupon code (PINK-XXXXXX) the attendee enters at registration. Assigned on the first win; moves with the person on a band reissue.';


CREATE TABLE IF NOT EXISTS public.pinkredible_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('award', 'redeem', 'void', 'reissue')),
  game_name TEXT,
  note TEXT,
  staff_user_id UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pinkredible_ledger IS
  'Every Pinkredible movement: +1 award (game_name says which game, staff_user_id who awarded it), -n redeem (note says who/what course), reissue moves between bands.';

CREATE INDEX IF NOT EXISTS pinkredible_ledger_wallet_id_idx ON public.pinkredible_ledger (wallet_id);
CREATE INDEX IF NOT EXISTS pinkredible_ledger_created_at_idx ON public.pinkredible_ledger (created_at DESC);

ALTER TABLE public.pinkredible_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pinkredible_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pinkredible_ledger TO authenticated;
GRANT ALL ON TABLE public.pinkredible_ledger TO service_role;

DROP POLICY IF EXISTS "Team can view pinkredible ledger" ON public.pinkredible_ledger;
CREATE POLICY "Team can view pinkredible ledger"
  ON public.pinkredible_ledger FOR SELECT TO authenticated
  USING (public.get_current_user_role() IN ('admin', 'staff', 'studio_manager'));


CREATE OR REPLACE FUNCTION public.pinkredible_value_inr()
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT 100 $$;

-- Pinkredibles from the 2026 party can be used until the end of 11 October 2026 IST (Manas, 6 Sep 2026).
CREATE OR REPLACE FUNCTION public.pinkredible_expires_at()
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT '2026-10-11 23:59:59+05:30'::TIMESTAMPTZ $$;

-- PINK- plus six characters from an alphabet without 0/O/1/I, unique across wallets.
CREATE OR REPLACE FUNCTION public.generate_pinkredible_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code TEXT;
  v_i INTEGER;
BEGIN
  LOOP
    v_code := 'PINK-';
    FOR v_i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::INTEGER, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.wallets WHERE pinkredible_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

-- Everything the POS shows about a round.
CREATE OR REPLACE FUNCTION public.check_pinkredible_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_wallet public.wallets;
BEGIN
  IF v_code !~ '^PINK-[A-Z0-9]{6}$' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'format');
  END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE pinkredible_code = v_code;
  IF v_wallet.id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'unknown');
  END IF;
  IF now() > public.pinkredible_expires_at() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired', 'expires_at', public.pinkredible_expires_at(),
                              'code', v_wallet.pinkredible_code, 'pinkredibles', v_wallet.pinkredible_balance);
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'expires_at', public.pinkredible_expires_at(),
    'code', v_wallet.pinkredible_code,
    'first_name', split_part(trim(v_wallet.attendee_name), ' ', 1),
    'band_hint', right(v_wallet.tag_id, 3),
    'active', v_wallet.status = 'active',
    'pinkredibles', v_wallet.pinkredible_balance,
    'value_inr', v_wallet.pinkredible_balance * public.pinkredible_value_inr(),
    'value_each_inr', public.pinkredible_value_inr()
  );
END;
$$;

COMMENT ON FUNCTION public.check_pinkredible_code(TEXT) IS
  'Public: validates a Pinkredible coupon code and returns the balance and ₹ value. First name only, no phone or email.';

-- ---------------------------------------------------------------------------
-- Redeem (admin / studio_manager, at registration)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_pinkredibles(
  p_code TEXT,
  p_count INTEGER DEFAULT 1,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  v_wallet public.wallets;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to redeem Pinkredibles';
  END IF;
  IF public.get_current_user_role() NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can redeem Pinkredibles';
  END IF;
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'Redeem at least one Pinkredible';
  END IF;
  IF now() > public.pinkredible_expires_at() THEN
    RAISE EXCEPTION 'Pinkredibles expired on %', to_char(public.pinkredible_expires_at() AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon YYYY');
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE pinkredible_code = v_code FOR UPDATE;
  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'No Pinkredibles found for code %', coalesce(NULLIF(v_code, ''), '(blank)');
  END IF;
  IF v_wallet.pinkredible_balance < p_count THEN
    RAISE EXCEPTION 'Only % Pinkredible% left on this code', v_wallet.pinkredible_balance,
      CASE WHEN v_wallet.pinkredible_balance = 1 THEN '' ELSE 's' END;
  END IF;

  UPDATE public.wallets
  SET pinkredible_balance = pinkredible_balance - p_count
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.pinkredible_ledger (wallet_id, delta, kind, note, staff_user_id)
  VALUES (v_wallet.id, -p_count, 'redeem', NULLIF(trim(coalesce(p_note, '')), ''), auth.uid());

  RETURN jsonb_build_object(
    'wallet_id', v_wallet.id,
    'code', v_wallet.pinkredible_code,
    'first_name', split_part(trim(v_wallet.attendee_name), ' ', 1),
    'redeemed', p_count,
    'redeemed_value_inr', p_count * public.pinkredible_value_inr(),
    'remaining', v_wallet.pinkredible_balance,
    'remaining_value_inr', v_wallet.pinkredible_balance * public.pinkredible_value_inr()
  );
END;
$$;

COMMENT ON FUNCTION public.redeem_pinkredibles(TEXT, INTEGER, TEXT) IS
  'Admin / studio_manager: take n Pinkredibles off a coupon code at course registration; the note should say the student and course.';

CREATE OR REPLACE FUNCTION public.pinkredible_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN public.get_current_user_role() NOT IN ('admin', 'studio_manager') THEN NULL ELSE
    jsonb_build_object(
      'awarded', COALESCE((SELECT SUM(delta) FROM public.pinkredible_ledger WHERE kind = 'award'), 0),
      'redeemed', COALESCE((SELECT -SUM(delta) FROM public.pinkredible_ledger WHERE kind = 'redeem'), 0),
      'outstanding', COALESCE((SELECT SUM(pinkredible_balance) FROM public.wallets WHERE status = 'active'), 0),
      'bands_with_pinkredibles', (SELECT count(*) FROM public.wallets WHERE pinkredible_balance > 0),
      'awards_by_game', COALESCE((SELECT jsonb_object_agg(game_name, n) FROM (SELECT coalesce(game_name,'?') AS game_name, count(*) AS n FROM public.pinkredible_ledger WHERE kind = 'award' GROUP BY 1) g), '{}'::jsonb),
      'value_each_inr', public.pinkredible_value_inr(),
      'expires_at', public.pinkredible_expires_at(),
      'outstanding_value_inr', COALESCE((SELECT SUM(pinkredible_balance) FROM public.wallets WHERE status = 'active'), 0) * public.pinkredible_value_inr()
    ) END;
$$;

-- ---------------------------------------------------------------------------
-- Award (staff / admin / studio_manager, from the POS after a game): one Pinkredible to the winner.
-- Charging for the game is unchanged (spend_wallet_coins on tap); this is a separate action.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_pinkredible(
  p_wallet_id UUID,
  p_game_id UUID DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := (SELECT auth.uid());
  v_role TEXT := COALESCE(public.get_current_user_role(), '');
  v_wallet public.wallets;
  v_game public.games;
  v_recent INTEGER;
BEGIN
  IF v_uid IS NULL OR v_role NOT IN ('admin', 'staff', 'studio_manager') THEN
    RAISE EXCEPTION 'Sign in as staff to award a Pinkredible';
  END IF;
  IF now() > public.pinkredible_expires_at() THEN
    RAISE EXCEPTION 'Pinkredibles can no longer be awarded';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Band not found';
  END IF;
  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'This band is blocked';
  END IF;

  IF p_game_id IS NOT NULL THEN
    SELECT * INTO v_game FROM public.games WHERE id = p_game_id;
    IF v_game.id IS NULL THEN
      RAISE EXCEPTION 'Game not found';
    END IF;
    IF v_role = 'staff' AND NOT EXISTS (
      SELECT 1 FROM public.staff_permissions sp
      WHERE sp.user_id = v_uid AND sp.game_id = p_game_id
    ) THEN
      RAISE EXCEPTION 'You can only award Pinkredibles for your own game';
    END IF;
  END IF;

  -- Guard against a double tap: same band, same game, same staffer, within 2 minutes.
  SELECT count(*) INTO v_recent FROM public.pinkredible_ledger
  WHERE wallet_id = v_wallet.id AND kind = 'award' AND staff_user_id = v_uid
    AND coalesce(game_name, '') = coalesce(v_game.name, '')
    AND created_at > now() - interval '2 minutes';
  IF v_recent > 0 THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'just_awarded',
      'first_name', split_part(trim(v_wallet.attendee_name), ' ', 1),
      'pinkredibles', v_wallet.pinkredible_balance, 'code', v_wallet.pinkredible_code);
  END IF;

  IF v_wallet.pinkredible_code IS NULL THEN
    v_wallet.pinkredible_code := public.generate_pinkredible_code();
  END IF;

  UPDATE public.wallets
  SET pinkredible_balance = pinkredible_balance + 1,
      pinkredible_code = v_wallet.pinkredible_code,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.pinkredible_ledger (wallet_id, delta, kind, game_name, note, staff_user_id)
  VALUES (v_wallet.id, 1, 'award', v_game.name, NULLIF(trim(coalesce(p_note, '')), ''), v_uid);

  RETURN jsonb_build_object(
    'awarded', true,
    'wallet_id', v_wallet.id,
    'first_name', split_part(trim(v_wallet.attendee_name), ' ', 1),
    'attendee_name', v_wallet.attendee_name,
    'band_hint', right(v_wallet.tag_id, 3),
    'game', v_game.name,
    'pinkredibles', v_wallet.pinkredible_balance,
    'code', v_wallet.pinkredible_code,
    'value_each_inr', public.pinkredible_value_inr(),
    'expires_at', public.pinkredible_expires_at()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.award_pinkredible(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_pinkredible(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public._reissue_wallet_unchecked(
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
  v_pink INTEGER;
  v_pink_code TEXT;
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
  v_pink := GREATEST(COALESCE(v_old.pinkredible_balance, 0), 0);
  v_pink_code := v_old.pinkredible_code;
  v_old_hint := right(v_old.tag_id, 3);

  -- Free the code first: it is unique across bands.
  UPDATE public.wallets
  SET coin_balance = 0, balance = 0, pinkredible_balance = 0, pinkredible_code = NULL, status = 'blocked'
  WHERE id = v_old.id;

  INSERT INTO public.wallets (tag_id, attendee_name, attendee_phone, studio, balance, coin_balance, status, event_order_id, pinkredible_balance, pinkredible_code)
  VALUES (v_tag, v_old.attendee_name, v_old.attendee_phone, v_old.studio, v_balance, v_balance, 'active', v_old.event_order_id, v_pink, v_pink_code)
  RETURNING id INTO v_new_id;

  IF v_balance > 0 THEN
    INSERT INTO public.transactions (wallet_id, type, amount, inr_amount, coin_amount, description, reference, staff_user_id)
    VALUES
      (v_old.id, 'spend', -v_balance, 0, -v_balance,
       'Band ' || coalesce(p_reason, 'lost') || ' · balance moved to band ···' || right(v_tag, 3), 'reissue:' || v_new_id::TEXT, v_staff),
      (v_new_id, 'load', v_balance, 0, v_balance,
       'Balance moved from ' || coalesce(p_reason, 'lost') || ' band ···' || v_old_hint, 'reissue:' || v_old.id::TEXT, v_staff);
  END IF;

  IF v_pink > 0 THEN
    INSERT INTO public.pinkredible_ledger (wallet_id, delta, kind, note, staff_user_id)
    VALUES
      (v_old.id, -v_pink, 'reissue', 'Moved to band ···' || right(v_tag, 3) || ' (' || coalesce(p_reason, 'lost') || ')', v_staff),
      (v_new_id, v_pink, 'reissue', 'Moved from band ···' || v_old_hint || ' (' || coalesce(p_reason, 'lost') || ')', v_staff);
  END IF;

  RETURN jsonb_build_object(
    'old_wallet_id', v_old.id,
    'new_wallet_id', v_new_id,
    'new_tag_id', v_tag,
    'moved_coins', v_balance,
    'moved_pinkredibles', v_pink,
    'attendee_name', v_old.attendee_name,
    'event_order_id', v_old.event_order_id
  );
END;
$$;


REVOKE ALL ON FUNCTION public.pinkredible_value_inr() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pinkredible_value_inr() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pinkredible_expires_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pinkredible_expires_at() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.generate_pinkredible_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pinkredible_code() TO service_role;
REVOKE ALL ON FUNCTION public.check_pinkredible_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_pinkredible_code(TEXT) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redeem_pinkredibles(TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_pinkredibles(TEXT, INTEGER, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pinkredible_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pinkredible_summary() TO authenticated, service_role;
