-- Cashfree payment tracking for Pink'D event landing-page orders.
-- This stays separate from NFC wallet Pink'D Coin accounting.

ALTER TABLE public.event_orders
ADD COLUMN IF NOT EXISTS payment_provider TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS cashfree_order_id TEXT,
ADD COLUMN IF NOT EXISTS cashfree_cf_order_id TEXT,
ADD COLUMN IF NOT EXISTS cashfree_payment_session_id TEXT,
ADD COLUMN IF NOT EXISTS cashfree_order_status TEXT,
ADD COLUMN IF NOT EXISTS cashfree_payment_status TEXT,
ADD COLUMN IF NOT EXISTS cashfree_order_response JSONB,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_payment_verified_at TIMESTAMPTZ;

ALTER TABLE public.event_orders DROP CONSTRAINT IF EXISTS event_orders_payment_provider_check;
ALTER TABLE public.event_orders
ADD CONSTRAINT event_orders_payment_provider_check
CHECK (payment_provider IN ('manual', 'cashfree'));

CREATE UNIQUE INDEX IF NOT EXISTS event_orders_cashfree_order_id_key
ON public.event_orders (cashfree_order_id)
WHERE cashfree_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_orders_payment_provider_idx
ON public.event_orders (payment_provider);

CREATE INDEX IF NOT EXISTS event_orders_paid_at_idx
ON public.event_orders (paid_at DESC)
WHERE paid_at IS NOT NULL;

COMMENT ON COLUMN public.event_orders.payment_provider IS 'Payment provider for event INR orders. Wallet Pink''D Coins are not credited by this flow.';
COMMENT ON COLUMN public.event_orders.cashfree_order_id IS 'Cashfree merchant order id for event booking checkout.';
COMMENT ON COLUMN public.event_orders.cashfree_payment_session_id IS 'Cashfree payment session id used by hosted checkout.';
COMMENT ON COLUMN public.event_orders.paid_at IS 'Timestamp when Cashfree/manual verification marked the event order paid.';
