-- Keep POS pricing/category unchanged; inclusion follows the game through renames.
ALTER TABLE public.games ADD COLUMN IF NOT EXISTS contributes_to_dare_board boolean NOT NULL DEFAULT false;
UPDATE public.games SET contributes_to_dare_board = true
WHERE lower(btrim(name)) IN ('karaoke', 'busk for a cause') AND NOT contributes_to_dare_board;

CREATE OR REPLACE FUNCTION public.get_dare_board_progress(
  p_before_created_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can view Dare Board progress' USING ERRCODE = '42501';
  END IF;

  IF (p_before_created_at IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'Both contribution cursor fields are required' USING ERRCODE = '22023';
  END IF;

  WITH contributions AS MATERIALIZED (
    SELECT t.id AS transaction_id, t.created_at, -t.coin_amount::bigint AS coins,
      COALESCE(NULLIF(left(split_part(regexp_replace(btrim(w.attendee_name), '\s+', ' ', 'g'), ' ', 1), 40), ''), 'Guest') AS first_name,
      NULLIF(left(btrim(w.studio), 80), '') AS studio,
      left(COALESCE(NULLIF(btrim(t.item_name), ''), g.name,
        CASE t.type::text WHEN 'food' THEN 'Food' WHEN 'drinks' THEN 'Bar' ELSE 'Tier 1 game' END), 120) AS item_name,
      EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.reverses_transaction_id = t.id AND r.type::text = 'refund'
      ) AS voided,
      CASE WHEN t.type::text = 'food' THEN 'food'
           WHEN t.type::text = 'drinks' THEN 'bar'
           WHEN g.contributes_to_dare_board THEN 'performances'
           ELSE 'tier_1' END AS source
    FROM public.transactions t
    LEFT JOIN public.games g ON g.id = t.game_id
    LEFT JOIN public.wallets w ON w.id = t.wallet_id
    WHERE t.coin_amount < 0
      AND (t.type::text IN ('food', 'drinks') OR (
        t.type::text = 'games' AND (
          g.contributes_to_dare_board OR t.item_category = 'tier_1' OR (
            (t.item_category IS NULL OR t.item_category = 'games') AND g.activity_group = 'tier_1'
          )
        )
      ))
  ), eligible AS (
    SELECT * FROM contributions WHERE NOT voided
  ), running AS (
    -- UUID breaks equal timestamp ties deterministically, independent of browser poll timing.
    SELECT *, sum(coins) OVER (ORDER BY created_at, transaction_id ROWS UNBOUNDED PRECEDING) AS running_coins
    FROM eligible
  ), milestones(milestone) AS (
    VALUES (10000), (25000), (50000), (75000), (100000), (150000),
      (200000), (300000), (400000), (500000), (1000000)
  ), pickers AS (
    SELECT m.milestone, r.transaction_id, r.created_at, r.coins, r.first_name, r.studio, r.item_name, r.source
    FROM milestones m JOIN running r
      ON r.running_coins >= m.milestone AND r.running_coins - r.coins < m.milestone
  ), log_window AS (
    SELECT * FROM contributions
    WHERE p_before_created_at IS NULL OR (created_at, transaction_id) < (p_before_created_at, p_before_id)
    ORDER BY created_at DESC, transaction_id DESC
    LIMIT 21
  ), log_page AS (
    SELECT * FROM log_window ORDER BY created_at DESC, transaction_id DESC LIMIT 20
  ), latest AS (
    SELECT * FROM contributions ORDER BY created_at DESC, transaction_id DESC LIMIT 3
  )
  SELECT jsonb_build_object(
    'total_coins', COALESCE(sum(coins), 0),
    'tier_1_coins', COALESCE(sum(coins) FILTER (WHERE source = 'tier_1'), 0),
    'food_coins', COALESCE(sum(coins) FILTER (WHERE source = 'food'), 0),
    'bar_coins', COALESCE(sum(coins) FILTER (WHERE source = 'bar'), 0),
    'performance_coins', COALESCE(sum(coins) FILTER (WHERE source = 'performances'), 0),
    'counted_sales', count(*),
    'milestone_pickers', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY milestone) FROM pickers p), '[]'::jsonb),
    'recent_transactions', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY created_at DESC, transaction_id DESC) FROM log_page l), '[]'::jsonb),
    'latest_transactions', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY created_at DESC, transaction_id DESC) FROM latest l), '[]'::jsonb),
    'log_has_more', (SELECT count(*) > 20 FROM log_window),
    'as_of', statement_timestamp()
  ) INTO result FROM eligible;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dare_board_progress(timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dare_board_progress(timestamptz, uuid) TO authenticated;
COMMENT ON FUNCTION public.get_dare_board_progress(timestamptz, uuid) IS
  'Admin-only net Tier 1/food/bar/Karaoke/Busk coin progress, deterministic net-history milestone pickers and paged contributions. First names/studios only; no contact or band details. Not INR revenue.';
