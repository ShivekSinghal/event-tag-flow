-- Extend event landing-page bookings while keeping wallet/Pink'D Coin accounting separate.

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS amount_inr NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS package_category TEXT,
ADD COLUMN IF NOT EXISTS package_key TEXT,
ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS pax INTEGER,
ADD COLUMN IF NOT EXISTS payment_reference TEXT,
ADD COLUMN IF NOT EXISTS booking_source TEXT NOT NULL DEFAULT 'landing_page';

UPDATE public.bookings
SET
  amount_inr = COALESCE(amount_inr, amount),
  package_category = COALESCE(package_category, 'legacy'),
  quantity = COALESCE(quantity, 1),
  pax = COALESCE(pax, 1),
  payment_reference = COALESCE(payment_reference, payment_id),
  booking_source = COALESCE(booking_source, 'landing_page')
WHERE amount_inr IS NULL
  OR package_category IS NULL
  OR quantity IS NULL
  OR pax IS NULL
  OR payment_reference IS NULL
  OR booking_source IS NULL;

ALTER TABLE public.bookings
ALTER COLUMN amount_inr SET NOT NULL,
ALTER COLUMN package_category SET NOT NULL,
ALTER COLUMN quantity SET DEFAULT 1,
ALTER COLUMN booking_source SET DEFAULT 'landing_page';

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_amount_inr_nonnegative;
ALTER TABLE public.bookings
ADD CONSTRAINT bookings_amount_inr_nonnegative CHECK (amount_inr >= 0) NOT VALID;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_quantity_positive;
ALTER TABLE public.bookings
ADD CONSTRAINT bookings_quantity_positive CHECK (quantity > 0) NOT VALID;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_pax_positive;
ALTER TABLE public.bookings
ADD CONSTRAINT bookings_pax_positive CHECK (pax IS NULL OR pax > 0) NOT VALID;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE public.bookings
ADD CONSTRAINT bookings_payment_status_check
CHECK (payment_status IN ('pending', 'manual_payment', 'paid', 'completed', 'failed', 'cancelled', 'refunded')) NOT VALID;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Anyone can view bookings" ON public.bookings;
DROP POLICY IF EXISTS "Anyone can update bookings" ON public.bookings;
DROP POLICY IF EXISTS "Public can create pending event bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can view event bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can update event bookings" ON public.bookings;

CREATE POLICY "Public can create pending event bookings"
ON public.bookings
FOR INSERT
TO anon, authenticated
WITH CHECK (
  payment_status IN ('pending', 'manual_payment')
  AND booking_source = 'landing_page'
  AND amount_inr = amount
);

CREATE POLICY "Admins can view event bookings"
ON public.bookings
FOR SELECT
TO authenticated
USING (public.get_current_user_role() = 'admin');

CREATE POLICY "Admins can update event bookings"
ON public.bookings
FOR UPDATE
TO authenticated
USING (public.get_current_user_role() = 'admin')
WITH CHECK (public.get_current_user_role() = 'admin');

GRANT INSERT ON public.bookings TO anon;
GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;

DROP TRIGGER IF EXISTS update_bookings_updated_at ON public.bookings;
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON COLUMN public.bookings.amount_inr IS 'Event landing-page booking amount in INR. Separate from Pink''D Coin wallet balances.';
COMMENT ON COLUMN public.bookings.package_category IS 'Landing-page package category such as intensives, party, package, or group.';
COMMENT ON COLUMN public.bookings.payment_reference IS 'Payment gateway/manual payment reference once payment is confirmed.';
