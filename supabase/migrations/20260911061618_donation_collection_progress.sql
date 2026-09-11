-- Read-only snapshot: never treat spending existing coins as another collection.
CREATE OR REPLACE FUNCTION public.get_donation_collection_progress()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.get_current_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  WITH paid_coin_orders AS (
    SELECT o.id, sum(i.line_total_inr) AS amount
    FROM public.event_orders o
    JOIN public.event_order_items i ON i.order_id = o.id AND i.package_category = 'coins'
    WHERE lower(btrim(o.payment_status)) IN ('paid', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM public.wallets w WHERE w.id = o.target_wallet_id AND upper(w.tag_id) LIKE 'TEST-%'
      )
    GROUP BY o.id
  ), counter_topups AS (
    SELECT t.id, t.inr_amount AS amount
    FROM public.transactions t
    WHERE t.type IN ('load', 'coin_purchase')
      AND coalesce(t.reference, '') !~* '^(coins:|prepaid:)'
      AND NOT EXISTS (
        SELECT 1 FROM public.wallets w WHERE w.id = t.wallet_id AND upper(w.tag_id) LIKE 'TEST-%'
      )
  ), collections AS (
    SELECT amount FROM paid_coin_orders WHERE amount > 0
    UNION ALL
    SELECT amount FROM counter_topups WHERE amount > 0
  )
  SELECT jsonb_build_object(
    'total_inr', coalesce((SELECT sum(amount) FROM collections), 0),
    'collection_count', (SELECT count(*) FROM collections),
    'goal_inr', 1000000,
    'unpriced_topups', (SELECT count(*) FROM counter_topups WHERE amount IS NULL),
    'generated_at', statement_timestamp()
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_donation_collection_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_donation_collection_progress() TO authenticated;
COMMENT ON FUNCTION public.get_donation_collection_progress() IS
  'Admin-only confirmed INR for coins: paid coin order lines plus standalone positive-INR top-ups, excluding tickets, spends, prepaid fulfilment and explicit TEST-prefixed bands. No writes.';
