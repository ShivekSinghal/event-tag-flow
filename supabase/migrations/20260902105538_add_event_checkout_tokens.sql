-- Short-lived checkout tokens allow public event payment functions without relying
-- on Supabase JWT verification for anonymous landing-page users.

ALTER TABLE public.event_orders
ADD COLUMN IF NOT EXISTS checkout_token_hash TEXT,
ADD COLUMN IF NOT EXISTS checkout_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS event_orders_checkout_token_expires_at_idx
ON public.event_orders (checkout_token_expires_at)
WHERE checkout_token_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_event_order_checkout(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_customer_email TEXT,
  p_cart_items JSONB,
  p_checkout_token_hash TEXT
)
RETURNS TABLE(order_id UUID, total_amount_inr NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF length(trim(coalesce(p_checkout_token_hash, ''))) < 32 THEN
    RAISE EXCEPTION 'Checkout token is required';
  END IF;

  RETURN QUERY
  WITH created AS (
    SELECT *
    FROM public.create_event_order(
      p_customer_name,
      p_customer_phone,
      p_customer_email,
      p_cart_items
    )
  ), updated AS (
    UPDATE public.event_orders
    SET
      checkout_token_hash = lower(trim(p_checkout_token_hash)),
      checkout_token_expires_at = now() + interval '30 minutes'
    WHERE id IN (SELECT created.order_id FROM created)
    RETURNING id
  )
  SELECT created.order_id, created.total_amount_inr
  FROM created;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) TO anon, authenticated;

COMMENT ON COLUMN public.event_orders.checkout_token_hash IS 'SHA-256 hash of short-lived browser checkout token for event payment function authorization.';
COMMENT ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) IS 'Creates a Pink''D event order and stores a short-lived checkout token hash for payment gateway setup.';
