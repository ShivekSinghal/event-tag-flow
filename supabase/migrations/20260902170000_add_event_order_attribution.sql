ALTER TABLE public.event_orders
ADD COLUMN IF NOT EXISTS attribution JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.event_orders.attribution IS 'Pink''D landing-page attribution payload, including UTM values, referrer, and landing page URL.';

CREATE OR REPLACE FUNCTION public.create_event_order_checkout(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_cart_items JSONB,
  p_checkout_token_hash TEXT,
  p_customer_studio TEXT,
  p_attribution JSONB
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_total_amount_inr NUMERIC;
  v_attribution JSONB;
BEGIN
  IF lower(trim(coalesce(p_checkout_token_hash, ''))) !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Valid checkout token hash is required';
  END IF;

  IF p_attribution IS NOT NULL AND jsonb_typeof(p_attribution) <> 'object' THEN
    RAISE EXCEPTION 'Attribution must be a JSON object';
  END IF;

  v_attribution := coalesce(p_attribution, '{}'::jsonb);

  SELECT created.order_id, created.total_amount_inr
  INTO v_order_id, v_total_amount_inr
  FROM public.create_event_order(
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_cart_items,
    p_customer_studio
  ) AS created;

  UPDATE public.event_orders
  SET
    checkout_token_hash = lower(trim(p_checkout_token_hash)),
    checkout_token_expires_at = now() + interval '30 minutes',
    attribution = v_attribution
  WHERE id = v_order_id;

  RETURN QUERY SELECT v_order_id, v_total_amount_inr;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) TO anon, authenticated;

COMMENT ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) IS 'Creates a Pink''D event order, stores checkout-token auth, and preserves landing-page attribution for campaign tracking.';
