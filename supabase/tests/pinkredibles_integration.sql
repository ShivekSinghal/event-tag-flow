-- Pinkredibles integration regression suite.
-- Run after 20260906090000_pinkredibles.sql. Every test record is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE pinkredible_test_ids (
  key TEXT PRIMARY KEY,
  id UUID NOT NULL
) ON COMMIT DROP;

INSERT INTO pinkredible_test_ids (key, id)
SELECT 'admin', id FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;

INSERT INTO pinkredible_test_ids (key, id)
SELECT 'operator', id FROM public.profiles WHERE role = 'staff' ORDER BY created_at LIMIT 1;

INSERT INTO pinkredible_test_ids (key, id)
SELECT 'other_operator', id FROM public.profiles WHERE role = 'staff' ORDER BY created_at OFFSET 1 LIMIT 1;

DO $$
BEGIN
  IF (SELECT count(*) FROM pinkredible_test_ids) <> 3 THEN
    RAISE EXCEPTION 'Pinkredibles tests require one admin and two staff profiles';
  END IF;
END;
$$;

WITH inserted AS (
  INSERT INTO public.games (
    name, description, price, studio, available,
    players_min, players_max, team_size, awards_pinkredible
  ) VALUES (
    '__Pinkredible integration test', 'Rollback-only test game', 10, 'Test', true,
    2, 2, 1, true
  )
  RETURNING id
)
INSERT INTO pinkredible_test_ids (key, id)
SELECT 'game', id FROM inserted;

INSERT INTO public.staff_permissions (user_id, permission_type, game_id)
SELECT id, 'game', (SELECT id FROM pinkredible_test_ids WHERE key = 'game')
FROM pinkredible_test_ids
WHERE key = 'operator';

WITH inserted AS (
  INSERT INTO public.wallets (tag_id, attendee_name, attendee_phone, studio, balance, coin_balance, status)
  VALUES
    ('TESTPINK01', 'Test Player One', '9000001001', 'Test', 100, 100, 'active'),
    ('TESTPINK02', 'Test Player Two', '9000001002', 'Test', 100, 100, 'active'),
    ('TESTPINK03', 'Test Player Three', '9000001003', 'Test', 100, 100, 'active'),
    ('TESTPINK04', 'Test Blocked Player', '9000001004', 'Test', 100, 100, 'blocked'),
    ('TESTPINK05', 'Test Low Balance', '9000001005', 'Test', 5, 5, 'active')
  RETURNING id, tag_id
)
INSERT INTO pinkredible_test_ids (key, id)
SELECT CASE tag_id
  WHEN 'TESTPINK01' THEN 'wallet_one'
  WHEN 'TESTPINK02' THEN 'wallet_two'
  WHEN 'TESTPINK03' THEN 'wallet_three'
  WHEN 'TESTPINK04' THEN 'wallet_blocked'
  ELSE 'wallet_low'
END, id
FROM inserted;

-- Unassigned staff cannot open the game.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (SELECT id FROM pinkredible_test_ids WHERE key = 'other_operator'),
    'role', 'authenticated'
  )::TEXT,
  true
);

DO $$
DECLARE
  denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.open_game_round((SELECT id FROM pinkredible_test_ids WHERE key = 'game'));
  EXCEPTION WHEN OTHERS THEN
    denied := position('not assigned' IN SQLERRM) > 0;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Unassigned staff opened a Pinkredibles round';
  END IF;
END;
$$;

-- Assigned staff gets one stable open round even if the UI retries.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (SELECT id FROM pinkredible_test_ids WHERE key = 'operator'),
    'role', 'authenticated'
  )::TEXT,
  true
);

WITH opened AS (
  SELECT (public.open_game_round((SELECT id FROM pinkredible_test_ids WHERE key = 'game'))->>'round_id')::UUID AS id
)
INSERT INTO pinkredible_test_ids (key, id)
SELECT 'round_one', id FROM opened;

DO $$
DECLARE
  retry_id UUID;
BEGIN
  retry_id := (public.open_game_round((SELECT id FROM pinkredible_test_ids WHERE key = 'game'))->>'round_id')::UUID;
  IF retry_id IS DISTINCT FROM (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one') THEN
    RAISE EXCEPTION 'Opening the same game twice created two live rounds';
  END IF;
END;
$$;

-- Lookup and NFC entries both debit once. The lookup debit carries the audit marker.
SELECT public.pay_game_round(
  (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
  (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one'),
  true
);

DO $$
BEGIN
  IF (SELECT coin_balance FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one')) <> 90 THEN
    RAISE EXCEPTION 'Lookup entry did not debit exactly 10 coins';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE wallet_id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one')
      AND reference LIKE '%via:phone-lookup%'
  ) THEN
    RAISE EXCEPTION 'Lookup entry is missing its audit marker';
  END IF;
END;
$$;

DO $$
DECLARE
  denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.pay_game_round(
      (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
      (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one')
    );
  EXCEPTION WHEN OTHERS THEN
    denied := position('already in this round' IN SQLERRM) > 0;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'The same player paid twice in one round';
  END IF;
END;
$$;

DO $$
DECLARE
  blocked_denied BOOLEAN := false;
  low_denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.pay_game_round(
      (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
      (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_blocked')
    );
  EXCEPTION WHEN OTHERS THEN
    blocked_denied := position('blocked' IN SQLERRM) > 0;
  END;
  BEGIN
    PERFORM public.pay_game_round(
      (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
      (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_low')
    );
  EXCEPTION WHEN OTHERS THEN
    low_denied := position('Insufficient' IN SQLERRM) > 0;
  END;
  IF NOT blocked_denied OR NOT low_denied THEN
    RAISE EXCEPTION 'Blocked or insufficient-balance band entered a round';
  END IF;
END;
$$;

SELECT public.pay_game_round(
  (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
  (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_two')
);

DO $$
DECLARE
  max_denied BOOLEAN := false;
  outsider_denied BOOLEAN := false;
BEGIN
  BEGIN
    PERFORM public.pay_game_round(
      (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
      (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_three')
    );
  EXCEPTION WHEN OTHERS THEN
    max_denied := position('round is full' IN lower(SQLERRM)) > 0;
  END;
  BEGIN
    PERFORM public.award_game_round(
      (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
      (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_three')
    );
  EXCEPTION WHEN OTHERS THEN
    outsider_denied := position('must be one of the players' IN SQLERRM) > 0;
  END;
  IF NOT max_denied OR NOT outsider_denied THEN
    RAISE EXCEPTION 'Round cap or winner eligibility was not enforced';
  END IF;
END;
$$;

SELECT public.award_game_round(
  (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
  (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one')
);

DO $$
DECLARE
  duplicate_denied BOOLEAN := false;
BEGIN
  IF (SELECT pinkredible_balance FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one')) <> 1 THEN
    RAISE EXCEPTION 'Winner did not receive exactly one Pinkredible';
  END IF;
  IF (SELECT count(*) FROM public.pinkredible_ledger WHERE round_id = (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one')) <> 1 THEN
    RAISE EXCEPTION 'Round did not create exactly one award ledger row';
  END IF;
  BEGIN
    PERFORM public.award_game_round(
      (SELECT id FROM pinkredible_test_ids WHERE key = 'round_one'),
      (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one')
    );
  EXCEPTION WHEN OTHERS THEN
    duplicate_denied := position('already closed' IN SQLERRM) > 0;
  END;
  IF NOT duplicate_denied THEN
    RAISE EXCEPTION 'A closed round awarded twice';
  END IF;
END;
$$;

-- Reissue moves both the reward and its code, while blocking and emptying the old band.
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (SELECT id FROM pinkredible_test_ids WHERE key = 'admin'),
    'role', 'authenticated'
  )::TEXT,
  true
);

WITH moved AS (
  SELECT (public.reissue_wallet(
    (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one'),
    'TESTPINK06',
    'integration test'
  )->>'new_wallet_id')::UUID AS id
)
INSERT INTO pinkredible_test_ids (key, id)
SELECT 'wallet_reissued', id FROM moved;

DO $$
DECLARE
  old_code TEXT;
  new_code TEXT;
BEGIN
  SELECT pinkredible_code INTO old_code FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one');
  SELECT pinkredible_code INTO new_code FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_reissued');
  IF old_code IS NOT NULL
     OR new_code IS NULL
     OR (SELECT pinkredible_balance FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_reissued')) <> 1
     OR (SELECT status FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_one')) <> 'blocked' THEN
    RAISE EXCEPTION 'Band reissue did not move the Pinkredible and code safely';
  END IF;
END;
$$;

-- The public check contract exposes exactly the approved fields and no band identifier.
DO $$
DECLARE
  result JSONB;
BEGIN
  SELECT public.check_pinkredible_code(pinkredible_code) INTO result
  FROM public.wallets
  WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_reissued');
  IF NOT (result ?& ARRAY['valid', 'pinkredibles', 'value_inr', 'first_name', 'expires_at'])
     OR (SELECT count(*) FROM jsonb_object_keys(result)) <> 5
     OR result ? 'tag_id'
     OR result ? 'band_hint' THEN
    RAISE EXCEPTION 'Public Pinkredible check returned an unsafe or incomplete contract: %', result;
  END IF;
END;
$$;

-- A genuine service-role call can redeem, cannot over-redeem, and records no fake staff id.
SELECT set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::TEXT, true);

DO $$
DECLARE
  code TEXT;
  denied BOOLEAN := false;
BEGIN
  SELECT pinkredible_code INTO code FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_reissued');
  BEGIN
    PERFORM public.redeem_pinkredibles(code, 2, 'integration over-redeem test');
  EXCEPTION WHEN OTHERS THEN
    denied := position('Only 1 Pinkredible left' IN SQLERRM) > 0;
  END;
  IF NOT denied THEN
    RAISE EXCEPTION 'Service redemption allowed an over-redemption';
  END IF;
  PERFORM public.redeem_pinkredibles(code, 1, 'integration service-role redemption');
  IF (SELECT pinkredible_balance FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_reissued')) <> 0 THEN
    RAISE EXCEPTION 'Service redemption did not reduce the balance';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pinkredible_ledger
    WHERE wallet_id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_reissued')
      AND kind = 'redeem'
      AND staff_user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Service redemption did not record a nullable staff reference';
  END IF;
END;
$$;

-- Assigned studio managers can run their own game; unassigned operations remain denied.
UPDATE public.profiles
SET role = 'studio_manager'
WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'other_operator');

INSERT INTO public.staff_permissions (user_id, permission_type, game_id)
SELECT
  (SELECT id FROM pinkredible_test_ids WHERE key = 'other_operator'),
  'game',
  (SELECT id FROM pinkredible_test_ids WHERE key = 'game');

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', (SELECT id FROM pinkredible_test_ids WHERE key = 'other_operator'),
    'role', 'authenticated'
  )::TEXT,
  true
);

WITH opened AS (
  SELECT (public.open_game_round((SELECT id FROM pinkredible_test_ids WHERE key = 'game'))->>'round_id')::UUID AS id
)
INSERT INTO pinkredible_test_ids (key, id)
SELECT 'studio_round', id FROM opened;

SELECT public.pay_game_round(
  (SELECT id FROM pinkredible_test_ids WHERE key = 'studio_round'),
  (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_three')
);

SELECT public.close_game_round(
  (SELECT id FROM pinkredible_test_ids WHERE key = 'studio_round'),
  'integration no-winner test'
);

DO $$
BEGIN
  IF (SELECT coin_balance FROM public.wallets WHERE id = (SELECT id FROM pinkredible_test_ids WHERE key = 'wallet_three')) <> 90 THEN
    RAISE EXCEPTION 'Closing without a winner refunded or duplicated the entry';
  END IF;
END;
$$;

-- Staff can check a code, but only admins/studio managers can read the ledger or redeem.
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.pinkredible_ledger', 'SELECT') IS NOT TRUE THEN
    RAISE EXCEPTION 'Authenticated role cannot reach the ledger through RLS';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pinkredible_ledger'
      AND policyname = 'Team can view pinkredible ledger'
      AND qual ILIKE '%studio_manager%'
      AND qual ILIKE '%admin%'
      AND qual NOT ILIKE '%staff%'
  ) THEN
    RAISE EXCEPTION 'Ledger policy exposes data beyond admins and studio managers';
  END IF;
END;
$$;

ROLLBACK;
