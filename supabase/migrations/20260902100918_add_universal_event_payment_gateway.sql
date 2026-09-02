-- Universal payment gateway selection for Pink'D event INR bookings.
-- This does not affect NFC wallet Pink'D Coin balances or top-up/POS accounting.

ALTER TABLE public.event_orders DROP CONSTRAINT IF EXISTS event_orders_payment_provider_check;
ALTER TABLE public.event_orders
ADD CONSTRAINT event_orders_payment_provider_check
CHECK (payment_provider IN ('manual', 'cashfree', 'razorpay'));

ALTER TABLE public.event_orders
ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT,
ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
ADD COLUMN IF NOT EXISTS razorpay_signature TEXT,
ADD COLUMN IF NOT EXISTS razorpay_payment_status TEXT,
ADD COLUMN IF NOT EXISTS razorpay_order_response JSONB,
ADD COLUMN IF NOT EXISTS razorpay_payment_response JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS event_orders_razorpay_order_id_key
ON public.event_orders (razorpay_order_id)
WHERE razorpay_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_orders_razorpay_payment_id_idx
ON public.event_orders (razorpay_payment_id)
WHERE razorpay_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payment_gateway_settings (
  id TEXT PRIMARY KEY DEFAULT 'event_bookings',
  active_provider TEXT NOT NULL DEFAULT 'cashfree',
  cashfree_enabled BOOLEAN NOT NULL DEFAULT true,
  razorpay_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_gateway_settings_singleton_check CHECK (id = 'event_bookings'),
  CONSTRAINT payment_gateway_settings_provider_check CHECK (active_provider IN ('cashfree', 'razorpay')),
  CONSTRAINT payment_gateway_settings_enabled_provider_check CHECK (
    (active_provider = 'cashfree' AND cashfree_enabled = true)
    OR (active_provider = 'razorpay' AND razorpay_enabled = true)
  )
);

INSERT INTO public.payment_gateway_settings (id, active_provider, cashfree_enabled, razorpay_enabled)
VALUES ('event_bookings', 'cashfree', true, true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.payment_gateway_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_gateway_settings FROM anon, authenticated;
GRANT SELECT ON public.payment_gateway_settings TO anon, authenticated;
GRANT UPDATE ON public.payment_gateway_settings TO authenticated;

DROP POLICY IF EXISTS "Public can read event payment gateway setting" ON public.payment_gateway_settings;
DROP POLICY IF EXISTS "Admins can update event payment gateway setting" ON public.payment_gateway_settings;

CREATE POLICY "Public can read event payment gateway setting"
ON public.payment_gateway_settings
FOR SELECT
TO anon, authenticated
USING (id = 'event_bookings');

CREATE POLICY "Admins can update event payment gateway setting"
ON public.payment_gateway_settings
FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

DROP TRIGGER IF EXISTS update_payment_gateway_settings_updated_at ON public.payment_gateway_settings;
CREATE TRIGGER update_payment_gateway_settings_updated_at
  BEFORE UPDATE ON public.payment_gateway_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.payment_gateway_settings IS 'Universal active payment gateway for Pink''D event landing-page INR bookings.';
COMMENT ON COLUMN public.event_orders.razorpay_order_id IS 'Razorpay order id for event booking checkout.';
COMMENT ON COLUMN public.event_orders.razorpay_payment_id IS 'Razorpay payment id returned after successful checkout.';
