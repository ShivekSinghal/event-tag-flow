ALTER TABLE public.event_orders
ADD COLUMN IF NOT EXISTS confirmation_email_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS confirmation_email_id TEXT,
ADD COLUMN IF NOT EXISTS confirmation_email_error TEXT;

COMMENT ON COLUMN public.event_orders.confirmation_email_sent_at IS 'Timestamp when the Pink''D event booking confirmation email was sent.';
COMMENT ON COLUMN public.event_orders.confirmation_email_id IS 'Provider message id for the Pink''D event booking confirmation email.';
COMMENT ON COLUMN public.event_orders.confirmation_email_error IS 'Last confirmation email error, if sending failed.';
