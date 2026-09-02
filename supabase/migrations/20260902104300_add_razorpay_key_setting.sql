-- Store non-secret gateway checkout configuration for Pink'D event bookings.
-- Razorpay key id is public; key secret remains only in Edge Function secrets.

ALTER TABLE public.payment_gateway_settings
ADD COLUMN IF NOT EXISTS razorpay_key_id TEXT,
ADD COLUMN IF NOT EXISTS cashfree_mode TEXT NOT NULL DEFAULT 'sandbox';

ALTER TABLE public.payment_gateway_settings DROP CONSTRAINT IF EXISTS payment_gateway_settings_cashfree_mode_check;
ALTER TABLE public.payment_gateway_settings
ADD CONSTRAINT payment_gateway_settings_cashfree_mode_check
CHECK (cashfree_mode IN ('sandbox', 'production'));

UPDATE public.payment_gateway_settings
SET razorpay_key_id = coalesce(razorpay_key_id, 'rzp_live_RbEZDGVIzypdpS')
WHERE id = 'event_bookings';

COMMENT ON COLUMN public.payment_gateway_settings.razorpay_key_id IS 'Public Razorpay key id used by browser checkout. The secret key remains in Edge Function secrets.';
COMMENT ON COLUMN public.payment_gateway_settings.cashfree_mode IS 'Cashfree checkout SDK mode for event bookings.';
