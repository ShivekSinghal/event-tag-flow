-- Reduce the exposed RPC surface and enforce wallet-management roles.

-- Pure helpers should not inherit a mutable role search path.
ALTER FUNCTION public.event_order_is_paid(TEXT) SET search_path = '';
ALTER FUNCTION public.event_order_hold_is_live(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) SET search_path = '';
ALTER FUNCTION public.normalize_phone_digits(TEXT) SET search_path = '';
ALTER FUNCTION public.event_attendee_form_locked_at() SET search_path = '';

-- Keep only the checkout signatures used by the current clients public.
REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_order_checkout(TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, JSONB) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_coin_order_checkout(UUID, TEXT, JSONB, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_coin_order_checkout(UUID, TEXT, JSONB, TEXT, JSONB, UUID) TO anon, authenticated, service_role;

-- These are the intentional public read/attendee endpoints.
REVOKE ALL ON FUNCTION public.get_event_party_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_party_status() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_event_phase_package_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_phase_package_stats() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.lookup_party_order(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_party_order(TEXT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.lookup_order_attendee_slots(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_order_attendee_slots(TEXT, TEXT) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.submit_order_attendees(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_attendees(TEXT, TEXT, JSONB) TO anon, authenticated, service_role;

-- Helper routines are callable only by their SECURITY DEFINER parents/service jobs.
REVOKE ALL ON FUNCTION public.event_order_attendee_slots_payload(public.event_orders) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_event_orders() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.find_paid_party_order(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_party_entry_counts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_party_phase_for_count(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_prepaid_coins_for_order(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_session_seat_counts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_party_phase(BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_order_is_paid(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_order_hold_is_live(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_phone_digits(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_attendee_form_locked_at() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.event_order_attendee_slots_payload(public.event_orders) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_event_orders() TO service_role;
GRANT EXECUTE ON FUNCTION public.find_paid_party_order(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_party_entry_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_party_phase_for_count(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_prepaid_coins_for_order(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_session_seat_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_party_phase(BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_order_is_paid(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_order_hold_is_live(TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_phone_digits(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_attendee_form_locked_at() TO service_role;

-- Preserve the existing Issue Tag implementations behind role-checking wrappers.
ALTER FUNCTION public.credit_prepaid_coins_to_wallet(UUID, UUID)
  RENAME TO _credit_prepaid_coins_to_wallet_unchecked;
ALTER FUNCTION public.link_wallet_to_event_order(UUID, UUID, BOOLEAN)
  RENAME TO _link_wallet_to_event_order_unchecked;
ALTER FUNCTION public.staff_list_bands_for_order(UUID)
  RENAME TO _staff_list_bands_for_order_unchecked;
ALTER FUNCTION public.reissue_wallet(UUID, TEXT, TEXT)
  RENAME TO _reissue_wallet_unchecked;
ALTER FUNCTION public.phone_has_band_on_order(UUID, TEXT)
  RENAME TO _phone_has_band_on_order_unchecked;
ALTER FUNCTION public.staff_lookup_party_order(TEXT)
  RENAME TO _staff_lookup_party_order_unchecked;

REVOKE ALL ON FUNCTION public._credit_prepaid_coins_to_wallet_unchecked(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._link_wallet_to_event_order_unchecked(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._staff_list_bands_for_order_unchecked(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reissue_wallet_unchecked(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._phone_has_band_on_order_unchecked(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._staff_lookup_party_order_unchecked(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._credit_prepaid_coins_to_wallet_unchecked(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public._link_wallet_to_event_order_unchecked(UUID, UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public._staff_list_bands_for_order_unchecked(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public._reissue_wallet_unchecked(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public._phone_has_band_on_order_unchecked(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public._staff_lookup_party_order_unchecked(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.credit_prepaid_coins_to_wallet(p_parent_order_id UUID, p_wallet_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(public.get_current_user_role(), '') NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can load prepaid coins';
  END IF;
  RETURN public._credit_prepaid_coins_to_wallet_unchecked(p_parent_order_id, p_wallet_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.link_wallet_to_event_order(
  p_wallet_id UUID,
  p_parent_order_id UUID,
  p_load_prepaid BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(public.get_current_user_role(), '') NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can link a band';
  END IF;
  RETURN public._link_wallet_to_event_order_unchecked(p_wallet_id, p_parent_order_id, p_load_prepaid);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_list_bands_for_order(p_parent_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(public.get_current_user_role(), '') NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can view issued bands';
  END IF;
  RETURN public._staff_list_bands_for_order_unchecked(p_parent_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reissue_wallet(
  p_old_wallet_id UUID,
  p_new_tag_id TEXT,
  p_reason TEXT DEFAULT 'lost'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(public.get_current_user_role(), '') NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can reissue a band';
  END IF;
  RETURN public._reissue_wallet_unchecked(p_old_wallet_id, p_new_tag_id, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.phone_has_band_on_order(p_parent_order_id UUID, p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(public.get_current_user_role(), '') NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can check issued bands';
  END IF;
  RETURN public._phone_has_band_on_order_unchecked(p_parent_order_id, p_phone);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_lookup_party_order(p_query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(public.get_current_user_role(), '') NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can look up bookings';
  END IF;
  RETURN public._staff_lookup_party_order_unchecked(p_query);
END;
$$;

REVOKE ALL ON FUNCTION public.credit_prepaid_coins_to_wallet(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_wallet_to_event_order(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_list_bands_for_order(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reissue_wallet(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_has_band_on_order(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_lookup_party_order(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.credit_prepaid_coins_to_wallet(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.link_wallet_to_event_order(UUID, UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_list_bands_for_order(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reissue_wallet(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.phone_has_band_on_order(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_lookup_party_order(TEXT) TO authenticated, service_role;

-- Profiles are created by the auth trigger; clients do not need direct INSERT.
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS "Allow new user profile creation" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Authenticated users can view permitted profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) = id
  OR (SELECT public.get_current_user_role()) = 'admin'
);

CREATE POLICY "Authenticated users can update permitted profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  (SELECT auth.uid()) = id
  OR (SELECT public.get_current_user_role()) = 'admin'
)
WITH CHECK (
  (SELECT auth.uid()) = id
  OR (SELECT public.get_current_user_role()) = 'admin'
);

CREATE OR REPLACE FUNCTION public.guard_profile_privileged_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
     AND COALESCE(public.get_current_user_role(), '') <> 'admin'
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW.assigned_game_id IS DISTINCT FROM OLD.assigned_game_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
     ) THEN
    RAISE EXCEPTION 'Only admins can change profile access fields';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_profile_privileged_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_profile_privileged_fields() TO service_role;

DROP TRIGGER IF EXISTS guard_profile_privileged_fields ON public.profiles;
CREATE TRIGGER guard_profile_privileged_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profile_privileged_fields();

-- Staff permission rows remain directly manageable by admins only.
REVOKE ALL ON TABLE public.staff_permissions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staff_permissions TO authenticated;

DROP POLICY IF EXISTS "Admins can manage all permissions" ON public.staff_permissions;
DROP POLICY IF EXISTS "Users can view their own permissions" ON public.staff_permissions;

CREATE POLICY "Authenticated users can view permitted permissions"
ON public.staff_permissions
FOR SELECT
TO authenticated
USING (
  (SELECT auth.uid()) = user_id
  OR (SELECT public.get_current_user_role()) = 'admin'
);

CREATE POLICY "Admins can insert permissions"
ON public.staff_permissions
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');

CREATE POLICY "Admins can update permissions"
ON public.staff_permissions
FOR UPDATE
TO authenticated
USING ((SELECT public.get_current_user_role()) = 'admin')
WITH CHECK ((SELECT public.get_current_user_role()) = 'admin');

CREATE POLICY "Admins can delete permissions"
ON public.staff_permissions
FOR DELETE
TO authenticated
USING ((SELECT public.get_current_user_role()) = 'admin');

-- Coin credit rows are written only through audited SECURITY DEFINER routines.
REVOKE ALL ON TABLE public.event_order_coin_credits FROM anon, authenticated;
GRANT SELECT ON TABLE public.event_order_coin_credits TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can view coin credits" ON public.event_order_coin_credits;
DROP POLICY IF EXISTS "Authenticated users can record coin credits" ON public.event_order_coin_credits;

CREATE POLICY "Wallet managers can view coin credits"
ON public.event_order_coin_credits
FOR SELECT
TO authenticated
USING ((SELECT public.get_current_user_role()) IN ('admin', 'studio_manager'));
