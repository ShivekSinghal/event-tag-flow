-- Pinkredibles (decided 3 Sep 2026): the reward ticket for winning a paid game, distinct from
-- Pink'd Coins (what you spend). 1 Pinkredible = ₹100 off course registration on hashtag.dance.
--
-- Fully digital, no printing (Manas, 6 Sep 2026). The Pinkredible is saved on the winner's band
-- exactly like coins; for team games the captain's band gets it. Attendees see their count and a
-- coupon code on /coins; the code is what they enter at registration.
--
-- Games are played in ROUNDS on one POS phone (Manas, 6 Sep 2026): several people each pay the
-- entry (Cricket 3 a side = 6, Issue With a Tissue 5 a side = 10, Hurdle and Minute to Win It
-- 1 v 1, Limbo and Bombastic individual with at least 5), the round starts once the minimum is in, and closing
-- the round awards exactly ONE Pinkredible to the scanned winner, who must be one of the
-- players. No refunds (Manas, 6 Sep 2026): a round that never fills or ends without a winner is
-- simply closed and the entries stay spent.
--
--   games.players_min / players_max / team_size / awards_pinkredible   the format per game
--   game_rounds, game_round_players                                     one round, its paid players
--   open_game_round(game)            staff: the open round for this game on this phone (created if none)
--   pay_game_round(round, wallet, via_lookup)  operator: charge the entry and add the player
--   award_game_round(round, winner)  staff: close the round, +1 Pinkredible on the winner's band
--   close_game_round(round, reason)  staff: close with no winner or not enough players (no refunds)
--   my_open_game_rounds()            staff: rounds still open on this phone (restores the POS after a reload)
--   wallets.pinkredible_balance / pinkredible_code                      balance and per-band coupon code
--   pinkredible_ledger                                                  every award and redemption
--   check_pinkredible_code(code)     public: is this code good, for how much (first name only); expires 11 Oct 2026
--   redeem_pinkredibles(code, n, note)  admin / studio_manager at registration
--   pinkredible_summary()            admin / studio_manager totals

-- ---------------------------------------------------------------------------
-- Game formats
-- ---------------------------------------------------------------------------
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS players_min INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS players_max INTEGER,
  ADD COLUMN IF NOT EXISTS team_size INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS awards_pinkredible BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_players_min_check;
ALTER TABLE public.games ADD CONSTRAINT games_players_min_check CHECK (players_min >= 1);
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_players_max_check;
ALTER TABLE public.games ADD CONSTRAINT games_players_max_check CHECK (players_max IS NULL OR players_max >= players_min);
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_team_size_check;
ALTER TABLE public.games ADD CONSTRAINT games_team_size_check CHECK (team_size >= 1);

COMMENT ON COLUMN public.games.players_min IS 'Paid players needed before a round can start (Cricket 6, Issue With a Tissue 10, Hurdle and Minute to Win It 2, Limbo/Bombastic 5).';
COMMENT ON COLUMN public.games.players_max IS 'Cap on paid players per round, NULL = no cap.';
COMMENT ON COLUMN public.games.team_size IS '1 for individual games; 3 or 5 for team games, where the captain''s band takes the Pinkredible.';
COMMENT ON COLUMN public.games.awards_pinkredible IS 'Whether the winner of a round gets a Pinkredible (Tier 2 and Tier 3 games in the 5 Sep 2026 SOP).';

-- The six prize games from the Game SOP (Priyanshi, 5 Sep 2026) with the formats Manas gave on
-- 6 Sep 2026. Existing rows with the same name are updated; missing ones are created. Prices are
-- the SOP tiers (750 / 1,000) and can be changed by an admin.
WITH sop(name, description, price, players_min, players_max, team_size) AS (
  VALUES
    ('Hurdle',              'Timed obstacle course, one on one. Fastest valid run wins.',                          750,  2,  2,    1),
    ('Issue With a Tissue', 'Two teams of five. First team to finish wins; the captain''s band gets the Pinkredible.', 750, 10, 10, 5),
    ('Cricket',             'Three a side. Highest score wins; the captain''s band gets the Pinkredible.',          750,  6,  6,    3),
    ('Limbo',               'Individual, at least five to start. Last one standing wins.',                        1000, 5, NULL,  1),
    ('Bombastic',           'Individual, at least five to start. Last one holding the bomb is out; last one left wins.', 1000, 5, NULL, 1),
    ('Minute to Win It',    'One on one: drink, flip cup, dice, 7 ball taps, stack 7 cups. Fastest valid completion wins.', 1000, 2, 2, 1)
)
UPDATE public.games g
SET description = sop.description,
    price = sop.price,
    players_min = sop.players_min,
    players_max = sop.players_max,
    team_size = sop.team_size,
    awards_pinkredible = true
FROM sop
WHERE lower(g.name) = lower(sop.name)
  AND NOT g.awards_pinkredible;

WITH sop(name, description, price, players_min, players_max, team_size) AS (
  VALUES
    ('Hurdle',              'Timed obstacle course, one on one. Fastest valid run wins.',                          750,  2,  2,    1),
    ('Issue With a Tissue', 'Two teams of five. First team to finish wins; the captain''s band gets the Pinkredible.', 750, 10, 10, 5),
    ('Cricket',             'Three a side. Highest score wins; the captain''s band gets the Pinkredible.',          750,  6,  6,    3),
    ('Limbo',               'Individual, at least five to start. Last one standing wins.',                        1000, 5, NULL,  1),
    ('Bombastic',           'Individual, at least five to start. Last one holding the bomb is out; last one left wins.', 1000, 5, NULL, 1),
    ('Minute to Win It',    'One on one: drink, flip cup, dice, 7 ball taps, stack 7 cups. Fastest valid completion wins.', 1000, 2, 2, 1)
)
INSERT INTO public.games (name, description, price, studio, available, players_min, players_max, team_size, awards_pinkredible)
SELECT sop.name, sop.description, sop.price, 'General', true, sop.players_min, sop.players_max, sop.team_size, true
FROM sop
WHERE NOT EXISTS (SELECT 1 FROM public.games g WHERE lower(g.name) = lower(sop.name));

-- ---------------------------------------------------------------------------
-- Wallet columns and the Pinkredible ledger
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Rounds
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES public.games(id) ON DELETE SET NULL,
  game_name TEXT NOT NULL,
  staff_user_id UUID NOT NULL REFERENCES public.profiles(id),
  entry_coins INTEGER NOT NULL CHECK (entry_coins >= 0),
  players_needed INTEGER NOT NULL CHECK (players_needed >= 1),
  players_max INTEGER CHECK (players_max IS NULL OR players_max >= players_needed),
  team_size INTEGER NOT NULL DEFAULT 1 CHECK (team_size >= 1),
  awards_pinkredible BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  winner_wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  close_reason TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

COMMENT ON TABLE public.game_rounds IS
  'One playing of a game on one POS phone: who paid in, whether it started, who won. The Pinkredible is awarded per round, never per payment.';

CREATE INDEX IF NOT EXISTS game_rounds_staff_open_idx ON public.game_rounds (staff_user_id, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS game_rounds_opened_at_idx ON public.game_rounds (opened_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS game_rounds_one_open_per_operator_game_idx
  ON public.game_rounds (staff_user_id, game_id) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.game_round_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, wallet_id)
);

CREATE INDEX IF NOT EXISTS game_round_players_wallet_idx ON public.game_round_players (wallet_id);

ALTER TABLE public.game_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_round_players ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.game_rounds, public.game_round_players FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.game_rounds, public.game_round_players TO authenticated;
GRANT ALL ON TABLE public.game_rounds, public.game_round_players TO service_role;

DROP POLICY IF EXISTS "Team can view game rounds" ON public.game_rounds;
CREATE POLICY "Team can view game rounds" ON public.game_rounds FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'admin'
    OR (
      public.get_current_user_role() IN ('staff', 'studio_manager')
      AND staff_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Team can view game round players" ON public.game_round_players;
CREATE POLICY "Team can view game round players" ON public.game_round_players FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.game_rounds rounds
      WHERE rounds.id = game_round_players.round_id
        AND rounds.staff_user_id = auth.uid()
        AND public.get_current_user_role() IN ('staff', 'studio_manager')
    )
  );

CREATE TABLE IF NOT EXISTS public.pinkredible_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  kind TEXT NOT NULL CHECK (kind IN ('award', 'redeem', 'void', 'reissue')),
  game_name TEXT,
  note TEXT,
  staff_user_id UUID REFERENCES public.profiles(id),
  round_id UUID REFERENCES public.game_rounds(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pinkredible_ledger IS
  'Every Pinkredible movement: +1 award (round_id is the game round it rewards, unique), -n redeem (note says who/what course), reissue moves between bands.';

CREATE UNIQUE INDEX IF NOT EXISTS pinkredible_ledger_round_id_key
  ON public.pinkredible_ledger (round_id) WHERE round_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pinkredible_ledger_wallet_id_idx ON public.pinkredible_ledger (wallet_id);
CREATE INDEX IF NOT EXISTS pinkredible_ledger_created_at_idx ON public.pinkredible_ledger (created_at DESC);

ALTER TABLE public.pinkredible_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pinkredible_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pinkredible_ledger TO authenticated;
GRANT ALL ON TABLE public.pinkredible_ledger TO service_role;

DROP POLICY IF EXISTS "Team can view pinkredible ledger" ON public.pinkredible_ledger;
CREATE POLICY "Team can view pinkredible ledger"
  ON public.pinkredible_ledger FOR SELECT TO authenticated
  USING (public.get_current_user_role() IN ('admin', 'studio_manager'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
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

-- Keep every POS debit behind the same permission model. Admins can sell every item; staff and
-- studio managers need the corresponding assignment. For custom games, a NULL game id means any
-- assigned game permission, matching the existing POS section access rule.
CREATE OR REPLACE FUNCTION public.spend_wallet_coins(
  p_wallet_id UUID,
  p_coin_amount INTEGER,
  p_transaction_type TEXT,
  p_item_name TEXT,
  p_item_category TEXT DEFAULT NULL,
  p_game_id UUID DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS TABLE (
  wallet_id UUID,
  new_coin_balance INTEGER,
  spent_coin_amount INTEGER,
  transaction_id UUID
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_transaction_id UUID;
  v_type TEXT;
  v_item_name TEXT;
  v_reference TEXT;
  v_role TEXT := public.get_current_user_role();
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'staff', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins, staff and studio managers can spend coins';
  END IF;

  v_type := COALESCE(NULLIF(TRIM(p_transaction_type), ''), 'food');
  IF v_type NOT IN ('games', 'drinks', 'food') THEN
    RAISE EXCEPTION 'Invalid transaction type';
  END IF;

  IF v_role <> 'admin' AND NOT public.user_has_permission(
    (SELECT auth.uid()),
    CASE WHEN v_type = 'games' THEN 'game' ELSE v_type END,
    CASE WHEN v_type = 'games' THEN p_game_id ELSE NULL END
  ) THEN
    RAISE EXCEPTION 'This % sale is not assigned to your account', v_type;
  END IF;

  IF p_coin_amount IS NULL OR p_coin_amount <= 0 THEN
    RAISE EXCEPTION 'Coin amount must be greater than zero';
  END IF;

  v_item_name := COALESCE(NULLIF(TRIM(p_item_name), ''), 'POS Item');
  v_reference := COALESCE(NULLIF(TRIM(p_reference), ''), UPPER(v_type) || '_' || extract(epoch from clock_timestamp())::bigint::text);

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Wallet is %', v_wallet.status;
  END IF;
  IF COALESCE(v_wallet.coin_balance, 0) < p_coin_amount THEN
    RAISE EXCEPTION 'Insufficient Pink''D Coins';
  END IF;

  UPDATE public.wallets
  SET coin_balance = COALESCE(coin_balance, 0) - p_coin_amount,
      balance = COALESCE(coin_balance, 0) - p_coin_amount,
      updated_at = now()
  WHERE id = v_wallet.id
  RETURNING * INTO v_wallet;

  INSERT INTO public.transactions (
    wallet_id, type, amount, inr_amount, coin_amount, description, reference,
    game_id, item_name, item_category, staff_user_id
  ) VALUES (
    v_wallet.id,
    v_type,
    -p_coin_amount,
    NULL,
    -p_coin_amount,
    CASE
      WHEN v_type = 'drinks' THEN 'Drinks Purchase: '
      WHEN v_type = 'games' THEN 'Game Purchase: '
      ELSE 'Food Purchase: '
    END || v_item_name,
    v_reference,
    p_game_id,
    v_item_name,
    COALESCE(NULLIF(TRIM(p_item_category), ''), v_type),
    (SELECT auth.uid())
  ) RETURNING id INTO v_transaction_id;

  IF p_game_id IS NOT NULL THEN
    INSERT INTO public.game_sales (game_id, transaction_id, quantity, sale_price, coin_price)
    VALUES (p_game_id, v_transaction_id, 1, p_coin_amount, p_coin_amount);
  END IF;

  RETURN QUERY
  SELECT v_wallet.id, v_wallet.coin_balance, p_coin_amount, v_transaction_id;
END;
$$;

-- Everything the POS shows about a round.
CREATE OR REPLACE FUNCTION public.game_round_payload(p_round_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.game_rounds;
  v_players JSONB;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id;
  IF v_round.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'wallet_id', w.id,
           'name', w.attendee_name,
           'band_hint', right(w.tag_id, 3),
           'paid_at', p.created_at
         ) ORDER BY p.created_at), '[]'::jsonb), count(*)
  INTO v_players, v_count
  FROM public.game_round_players p
  JOIN public.wallets w ON w.id = p.wallet_id
  WHERE p.round_id = v_round.id;
  RETURN jsonb_build_object(
    'round_id', v_round.id,
    'game_id', v_round.game_id,
    'game_name', v_round.game_name,
    'entry_coins', v_round.entry_coins,
    'players_needed', v_round.players_needed,
    'players_max', v_round.players_max,
    'team_size', v_round.team_size,
    'awards_pinkredible', v_round.awards_pinkredible,
    'status', v_round.status,
    'players_paid', v_count,
    'can_start', v_count >= v_round.players_needed,
    'is_full', v_round.players_max IS NOT NULL AND v_count >= v_round.players_max,
    'players', v_players,
    'winner_wallet_id', v_round.winner_wallet_id,
    'opened_at', v_round.opened_at,
    'closed_at', v_round.closed_at
  );
END;
$$;

-- Round owner with the assigned game permission, or an admin, may act on a round.
CREATE OR REPLACE FUNCTION public.assert_round_operator(p_round public.game_rounds)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := public.get_current_user_role()::TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as staff';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'staff', 'studio_manager') THEN
    RAISE EXCEPTION 'This account cannot operate game rounds';
  END IF;
  IF p_round.staff_user_id IS DISTINCT FROM auth.uid() AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'This round belongs to another POS phone';
  END IF;
  IF v_role <> 'admin' AND (
    p_round.game_id IS NULL
    OR NOT public.user_has_permission(auth.uid(), 'game', p_round.game_id)
  ) THEN
    RAISE EXCEPTION 'This game is not assigned to your account';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- open_game_round: the open round for this game on this phone, created if none
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_game_round(p_game_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_game public.games;
  v_round_id UUID;
  v_role TEXT := public.get_current_user_role()::TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in as staff to run a game';
  END IF;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'staff', 'studio_manager') THEN
    RAISE EXCEPTION 'This account cannot operate game rounds';
  END IF;
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id;
  IF v_game.id IS NULL THEN
    RAISE EXCEPTION 'Game not found';
  END IF;
  IF NOT v_game.available THEN
    RAISE EXCEPTION '% is not available right now', v_game.name;
  END IF;
  IF v_role <> 'admin' AND NOT public.user_has_permission(auth.uid(), 'game', v_game.id) THEN
    RAISE EXCEPTION 'This game is not assigned to your account';
  END IF;

  SELECT id INTO v_round_id
  FROM public.game_rounds
  WHERE game_id = v_game.id AND staff_user_id = auth.uid() AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_round_id IS NULL THEN
    INSERT INTO public.game_rounds (game_id, game_name, staff_user_id, entry_coins, players_needed, players_max, team_size, awards_pinkredible)
    VALUES (v_game.id, v_game.name, auth.uid(), round(v_game.price)::INTEGER, v_game.players_min, v_game.players_max, v_game.team_size, v_game.awards_pinkredible)
    ON CONFLICT (staff_user_id, game_id) WHERE status = 'open' DO NOTHING
    RETURNING id INTO v_round_id;

    IF v_round_id IS NULL THEN
      SELECT id INTO v_round_id
      FROM public.game_rounds
      WHERE game_id = v_game.id AND staff_user_id = auth.uid() AND status = 'open'
      ORDER BY opened_at DESC
      LIMIT 1;
    END IF;
  END IF;

  RETURN public.game_round_payload(v_round_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- pay_game_round: charge one player's entry and add them to the round
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_game_round(
  p_round_id UUID,
  p_wallet_id UUID,
  p_via_phone_lookup BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.game_rounds;
  v_wallet public.wallets;
  v_count INTEGER;
  v_txn_id UUID;
  v_new_balance INTEGER;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'Round not found';
  END IF;
  PERFORM public.assert_round_operator(v_round);
  IF v_round.status <> 'open' THEN
    RAISE EXCEPTION 'This round is already %', v_round.status;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id;
  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Band not found';
  END IF;
  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'This band is %', v_wallet.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_round_players WHERE round_id = v_round.id AND wallet_id = v_wallet.id) THEN
    RAISE EXCEPTION '% is already in this round', v_wallet.attendee_name;
  END IF;
  SELECT count(*) INTO v_count FROM public.game_round_players WHERE round_id = v_round.id;
  IF v_round.players_max IS NOT NULL AND v_count >= v_round.players_max THEN
    RAISE EXCEPTION 'This round is full (% players). Finish it, then open the next one.', v_round.players_max;
  END IF;

  -- Charge the entry through the same path every game sale uses (role check, balance check, transaction row).
  IF v_round.entry_coins > 0 THEN
    SELECT s.transaction_id, s.new_coin_balance
    INTO v_txn_id, v_new_balance
    FROM public.spend_wallet_coins(
      v_wallet.id, v_round.entry_coins, 'games', v_round.game_name, 'games', v_round.game_id,
      'ROUND_' || replace(v_round.id::TEXT, '-', '')
        || CASE WHEN p_via_phone_lookup THEN ' via:phone-lookup' ELSE '' END
    ) AS s;
  ELSE
    v_new_balance := COALESCE(v_wallet.coin_balance, 0);
  END IF;

  INSERT INTO public.game_round_players (round_id, wallet_id, transaction_id)
  VALUES (v_round.id, v_wallet.id, v_txn_id);

  RETURN public.game_round_payload(v_round.id)
    || jsonb_build_object('paid_wallet_id', v_wallet.id, 'paid_name', v_wallet.attendee_name, 'new_coin_balance', v_new_balance, 'transaction_id', v_txn_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- award_game_round: close the round and put ONE Pinkredible on the winner's band
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.award_game_round(p_round_id UUID, p_winner_wallet_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.game_rounds;
  v_wallet public.wallets;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'Round not found';
  END IF;
  PERFORM public.assert_round_operator(v_round);
  IF v_round.status <> 'open' THEN
    RAISE EXCEPTION 'This round is already %', v_round.status;
  END IF;
  SELECT count(*) INTO v_count FROM public.game_round_players WHERE round_id = v_round.id;
  IF v_count < v_round.players_needed THEN
    RAISE EXCEPTION '% needs % players to start; % paid so far', v_round.game_name, v_round.players_needed, v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_round_players WHERE round_id = v_round.id AND wallet_id = p_winner_wallet_id) THEN
    RAISE EXCEPTION 'The winner must be one of the players who paid for this round';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_winner_wallet_id FOR UPDATE;
  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'This band is %', v_wallet.status;
  END IF;

  IF v_round.awards_pinkredible THEN
    UPDATE public.wallets
    SET pinkredible_balance = pinkredible_balance + 1,
        pinkredible_code = COALESCE(pinkredible_code, public.generate_pinkredible_code())
    WHERE id = v_wallet.id
    RETURNING * INTO v_wallet;

    INSERT INTO public.pinkredible_ledger (wallet_id, delta, kind, game_name, staff_user_id, round_id)
    VALUES (v_wallet.id, 1, 'award', v_round.game_name, auth.uid(), v_round.id);
  END IF;

  UPDATE public.game_rounds
  SET status = 'closed', winner_wallet_id = v_wallet.id, closed_at = now(), close_reason = 'won'
  WHERE id = v_round.id;

  RETURN public.game_round_payload(v_round.id) || jsonb_build_object(
    'winner_name', v_wallet.attendee_name,
    'winner_band_hint', right(v_wallet.tag_id, 3),
    'awarded', CASE WHEN v_round.awards_pinkredible THEN 1 ELSE 0 END,
    'pinkredibles', v_wallet.pinkredible_balance,
    'code', v_wallet.pinkredible_code,
    'value_inr', v_wallet.pinkredible_balance * public.pinkredible_value_inr()
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- close_game_round: nobody won, or the round never filled. Entries are not refunded.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_game_round(p_round_id UUID, p_reason TEXT DEFAULT 'no winner')
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_round public.game_rounds;
BEGIN
  SELECT * INTO v_round FROM public.game_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'Round not found';
  END IF;
  PERFORM public.assert_round_operator(v_round);
  IF v_round.status <> 'open' THEN
    RAISE EXCEPTION 'This round is already %', v_round.status;
  END IF;
  UPDATE public.game_rounds
  SET status = 'closed', closed_at = now(), close_reason = left(coalesce(NULLIF(trim(p_reason), ''), 'no winner'), 120)
  WHERE id = v_round.id;
  RETURN public.game_round_payload(v_round.id);
END;
$$;

-- ---------------------------------------------------------------------------
-- my_open_game_rounds: what this phone still has open (POS restores after a reload)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_open_game_rounds()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::jsonb ELSE COALESCE(
    (SELECT jsonb_agg(public.game_round_payload(r.id) ORDER BY r.opened_at)
     FROM public.game_rounds r
     WHERE r.staff_user_id = auth.uid() AND r.status = 'open'),
    '[]'::jsonb) END;
$$;

-- ---------------------------------------------------------------------------
-- Check (public, no personal data beyond a first name): what is this code worth?
-- hashtag.dance registration can call this before accepting the code.
-- ---------------------------------------------------------------------------
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
  IF v_wallet.status <> 'active' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'inactive');
  END IF;
  IF now() > public.pinkredible_expires_at() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired', 'expires_at', public.pinkredible_expires_at(),
                              'pinkredibles', v_wallet.pinkredible_balance);
  END IF;
  RETURN jsonb_build_object(
    'valid', true,
    'expires_at', public.pinkredible_expires_at(),
    'first_name', split_part(trim(v_wallet.attendee_name), ' ', 1),
    'pinkredibles', v_wallet.pinkredible_balance,
    'value_inr', v_wallet.pinkredible_balance * public.pinkredible_value_inr()
  );
END;
$$;

COMMENT ON FUNCTION public.check_pinkredible_code(TEXT) IS
  'Public: validates a Pinkredible coupon code and returns only balance, ₹ value, first name and expiry.';

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
  v_is_service_role BOOLEAN := auth.role() = 'service_role';
BEGIN
  IF auth.uid() IS NULL AND NOT v_is_service_role THEN
    RAISE EXCEPTION 'Sign in to redeem Pinkredibles';
  END IF;
  IF NOT v_is_service_role AND public.get_current_user_role() NOT IN ('admin', 'studio_manager') THEN
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
  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'This Pinkredible code is attached to an inactive band';
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

-- ---------------------------------------------------------------------------
-- Admin totals
-- ---------------------------------------------------------------------------
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
      'rounds_played', (SELECT count(*) FROM public.game_rounds WHERE status = 'closed' AND winner_wallet_id IS NOT NULL),
      'rounds_no_winner', (SELECT count(*) FROM public.game_rounds WHERE status = 'closed' AND winner_wallet_id IS NULL),
      'value_each_inr', public.pinkredible_value_inr(),
      'expires_at', public.pinkredible_expires_at(),
      'outstanding_value_inr', COALESCE((SELECT SUM(pinkredible_balance) FROM public.wallets WHERE status = 'active'), 0) * public.pinkredible_value_inr()
    ) END;
$$;

-- ---------------------------------------------------------------------------
-- Reissue keeps the Pinkredibles and the code with the person.
-- Since 20260904210000 (Shivek's hardening) public.reissue_wallet is a role-checked wrapper
-- around this body; the wrapper is left untouched.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Staff band list on Issue Tag shows Pinkredibles too (body behind Shivek's role-checked wrapper)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._staff_list_bands_for_order_unchecked(p_parent_order_id UUID)
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
        'pinkredibles', COALESCE(w.pinkredible_balance, 0),
        'pinkredible_code', w.pinkredible_code,
        'status', w.status,
        'created_at', w.created_at
      ) ORDER BY w.created_at)
     FROM public.wallets w
     WHERE w.event_order_id = p_parent_order_id),
    '[]'::jsonb) END;
$$;

-- ---------------------------------------------------------------------------
-- /coins lookup: the attendee sees their Pinkredibles and coupon code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_party_order(p_order_ref TEXT, p_contact TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.event_orders;
  v_phone TEXT := public.normalize_phone_digits(p_contact);
  v_matched_wallet UUID;
  v_party_entries INTEGER;
  v_coins_purchased INTEGER;
  v_coins_pending INTEGER;
  v_coins_credited INTEGER;
  v_coins_waiting INTEGER;
  v_bands JSONB;
  v_band_count INTEGER;
  v_balance INTEGER := 0;
  v_hint TEXT;
  v_pink INTEGER := 0;
  v_pink_code TEXT;
BEGIN
  v_order := public.find_paid_party_order(p_order_ref, p_contact);
  -- Not the booker? Try the phone given at the gate, then the attendee form.
  IF v_order.id IS NULL AND length(v_phone) = 10 THEN
    SELECT wallets.id
    INTO v_matched_wallet
    FROM public.wallets
    JOIN public.event_orders orders ON orders.id = wallets.event_order_id
    WHERE wallets.status = 'active'
      AND public.normalize_phone_digits(wallets.attendee_phone) = v_phone
      AND public.event_order_is_paid(orders.payment_status)
    ORDER BY wallets.created_at DESC
    LIMIT 1;
    IF v_matched_wallet IS NOT NULL THEN
      SELECT orders.* INTO v_order
      FROM public.event_orders orders
      JOIN public.wallets ON wallets.id = v_matched_wallet
      WHERE orders.id = wallets.event_order_id;
    END IF;
    IF v_order.id IS NULL THEN
      SELECT orders.* INTO v_order
      FROM public.event_order_attendees attendees
      JOIN public.event_orders orders ON orders.id = attendees.order_id
      WHERE public.normalize_phone_digits(attendees.attendee_phone) = v_phone
        AND public.event_order_is_paid(orders.payment_status)
      ORDER BY attendees.created_at DESC
      LIMIT 1;
    END IF;
  END IF;
  IF v_order.id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Booker typed their own phone: match their band by that phone too.
  IF v_matched_wallet IS NULL AND length(v_phone) = 10 THEN
    SELECT id INTO v_matched_wallet FROM public.wallets
    WHERE event_order_id = v_order.id AND status = 'active'
      AND public.normalize_phone_digits(attendee_phone) = v_phone
    ORDER BY created_at DESC LIMIT 1;
  END IF;
  SELECT COALESCE(SUM(items.quantity * COALESCE(items.pax, 1)), 0)::INTEGER
  INTO v_party_entries
  FROM public.event_order_items items
  WHERE items.order_id = v_order.id AND items.package_category IN ('party', 'package', 'group');
  SELECT
    COALESCE(SUM(packages.coin_amount * items.quantity) FILTER (WHERE public.event_order_is_paid(coin_orders.payment_status)), 0)::INTEGER,
    COALESCE(SUM(packages.coin_amount * items.quantity) FILTER (WHERE public.event_order_hold_is_live(coin_orders.payment_status, coin_orders.checkout_token_expires_at, coin_orders.created_at)), 0)::INTEGER
  INTO v_coins_purchased, v_coins_pending
  FROM public.event_orders coin_orders
  JOIN public.event_order_items items ON items.order_id = coin_orders.id AND items.package_category = 'coins'
  LEFT JOIN public.coin_packages packages ON packages.id::TEXT = replace(items.package_key, 'coin-package:', '')
  WHERE coin_orders.parent_order_id = v_order.id;
  SELECT COALESCE(SUM(coins), 0)::INTEGER INTO v_coins_credited
  FROM public.event_order_coin_credits WHERE parent_order_id = v_order.id;
  SELECT COALESCE(SUM(public.get_coin_order_amount(coin_orders.id)), 0)::INTEGER
  INTO v_coins_waiting
  FROM public.event_orders coin_orders
  WHERE coin_orders.parent_order_id = v_order.id
    AND coin_orders.booking_source = 'coins_page'
    AND public.event_order_is_paid(coin_orders.payment_status)
    AND NOT EXISTS (SELECT 1 FROM public.event_order_coin_credits c WHERE c.coin_order_id = coin_orders.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'wallet_id', w.id,
           'name', split_part(trim(w.attendee_name), ' ', 1),
           'band_hint', right(w.tag_id, 3),
           'coin_balance', COALESCE(w.coin_balance, 0),
           'pinkredibles', COALESCE(w.pinkredible_balance, 0),
           'pinkredible_code', w.pinkredible_code
         ) ORDER BY w.created_at), '[]'::jsonb), count(*)
  INTO v_bands, v_band_count
  FROM public.wallets w
  WHERE w.event_order_id = v_order.id AND w.status = 'active';
  IF v_matched_wallet IS NULL AND v_band_count = 1 THEN
    SELECT id INTO v_matched_wallet FROM public.wallets WHERE event_order_id = v_order.id AND status = 'active';
  END IF;
  IF v_matched_wallet IS NOT NULL THEN
    SELECT COALESCE(coin_balance, 0), right(tag_id, 3), COALESCE(pinkredible_balance, 0), pinkredible_code
    INTO v_balance, v_hint, v_pink, v_pink_code
    FROM public.wallets WHERE id = v_matched_wallet;
  END IF;
  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_ref', upper(left(v_order.id::TEXT, 8)),
    'first_name', split_part(trim(v_order.customer_name), ' ', 1),
    'party_entries', v_party_entries,
    'coins_purchased', v_coins_purchased,
    'coins_pending', v_coins_pending,
    'coins_credited', v_coins_credited,
    'coins_waiting', v_coins_waiting,
    'wallet_linked', v_band_count > 0,
    'band_count', v_band_count,
    'bands', v_bands,
    'matched_wallet_id', v_matched_wallet,
    'coin_balance', v_balance,
    'band_hint', v_hint,
    'pinkredibles', v_pink,
    'pinkredible_code', v_pink_code,
    'pinkredible_value_inr', public.pinkredible_value_inr(),
    'pinkredible_expires_at', public.pinkredible_expires_at(),
    'paid_at', v_order.paid_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants (same shape as 20260904070518: nothing to PUBLIC, explicit per role)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pinkredible_value_inr() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pinkredible_value_inr() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.pinkredible_expires_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pinkredible_expires_at() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.generate_pinkredible_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pinkredible_code() TO service_role;

REVOKE ALL ON FUNCTION public.game_round_payload(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_round_payload(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.assert_round_operator(public.game_rounds) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_round_operator(public.game_rounds) TO service_role;

REVOKE ALL ON FUNCTION public.open_game_round(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_game_round(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pay_game_round(UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_game_round(UUID, UUID, BOOLEAN) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.award_game_round(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.award_game_round(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.close_game_round(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_game_round(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.my_open_game_rounds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_open_game_rounds() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_pinkredible_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_pinkredible_code(TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.redeem_pinkredibles(TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_pinkredibles(TEXT, INTEGER, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pinkredible_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pinkredible_summary() TO authenticated, service_role;

-- _reissue_wallet_unchecked / _staff_list_bands_for_order_unchecked keep the grants set by
-- 20260904210000 (service_role only; callers go through the role-checked wrappers).

REVOKE ALL ON FUNCTION public.lookup_party_order(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_party_order(TEXT, TEXT) TO anon, authenticated, service_role;
