-- Local test data. Runs only on `supabase db reset` / `supabase start` for a LOCAL stack.
-- Never applied to production (seed.sql is not part of `supabase db push`).
--
-- Gives you:
--   * an admin login for /pinkd-login:  admin@pinkd.local / Pinkd-Test-2026
--   * a staff login:                    staff@pinkd.local / Pinkd-Test-2026
--   * paid bookings covering every pass type, with attendee names, one band
--     already issued, and one prepaid coin order waiting for a band
--   * one abandoned checkout (expired hold) for the expiry logic
-- Use scripts/local-e2e.sh to "pay" new orders you create through the site.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Logins
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_admin UUID := '11111111-1111-1111-1111-111111111111';
  v_staff UUID := '22222222-2222-2222-2222-222222222222';
  v_hash TEXT := crypt('Pinkd-Test-2026', gen_salt('bf'));
BEGIN
  -- GoTrue scans these token columns as non-null strings; hand-inserted rows must use '' not NULL.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token,
                          is_sso_user, is_anonymous)
  VALUES
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@pinkd.local', v_hash, now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Local Admin"}', now(), now(), '', '', '', '', '', '', '', '', false, false),
    (v_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@pinkd.local', v_hash, now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Local Staff"}', now(), now(), '', '', '', '', '', '', '', '', false, false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_admin, v_admin::TEXT, 'email', jsonb_build_object('sub', v_admin::TEXT, 'email', 'admin@pinkd.local', 'email_verified', true), now(), now(), now()),
    (gen_random_uuid(), v_staff, v_staff::TEXT, 'email', jsonb_build_object('sub', v_staff::TEXT, 'email', 'staff@pinkd.local', 'email_verified', true), now(), now(), now())
  ON CONFLICT DO NOTHING;

  -- handle_new_user() created the profiles as 'staff'; promote the admin.
  UPDATE public.profiles SET role = 'admin', full_name = 'Local Admin' WHERE id = v_admin;
  UPDATE public.profiles SET role = 'staff', full_name = 'Local Staff' WHERE id = v_staff;
END $$;

-- Gateway settings row the app reads (Cashfree sandbox; no keys locally, so payments stop at the gateway step).
INSERT INTO public.payment_gateway_settings (id, active_provider, cashfree_mode)
VALUES ('event_bookings', 'cashfree', 'sandbox')
ON CONFLICT (id) DO UPDATE SET active_provider = EXCLUDED.active_provider, cashfree_mode = EXCLUDED.cashfree_mode;

-- ---------------------------------------------------------------------------
-- Bookings (created through the real checkout function, then marked paid)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_hash TEXT := repeat('a', 64);
  v_crew UUID;
  v_party2 UUID;
  v_full UUID;
  v_intensive UUID;
  v_abandoned UUID;
  v_coins UUID;
  v_wallet UUID;
  v_pack UUID;
BEGIN
  -- 1. Crew of 6 · Manas (booker) · paid
  SELECT order_id INTO v_crew FROM public.create_event_order_checkout(
    'Manas Yellapantula', '9205488417', 'manas210890@gmail.com',
    '[{"item_type":"event_package","package_key":"six-pax-four-intensives-party","quantity":1,"selected_time_slots":[]}]'::jsonb,
    v_hash, 'Rajouri Garden (RG)', '{"utm_source":"seed"}'::jsonb);
  UPDATE public.event_orders SET payment_status = 'paid', payment_provider = 'cashfree', payment_reference = 'seed_crew', paid_at = now() - interval '2 days' WHERE id = v_crew;

  PERFORM public.submit_order_attendees(upper(left(v_crew::TEXT, 8)), '', '[
    {"position":1,"attendee_name":"Manas Yellapantula","attendee_phone":"9205488417"},
    {"position":2,"attendee_name":"Priya Sharma","attendee_phone":"9811022334"},
    {"position":3,"attendee_name":"Rahul Mehta","attendee_phone":"9987011223"}
  ]'::jsonb);

  -- 2. Two party entries · Aditi · paid, names not yet added
  SELECT order_id INTO v_party2 FROM public.create_event_order_checkout(
    'Aditi Rao', '9876500001', 'aditi@example.com',
    '[{"item_type":"event_package","package_key":"party-entry","quantity":2,"selected_time_slots":[]}]'::jsonb,
    v_hash, 'Not a Student', '{}'::jsonb);
  UPDATE public.event_orders SET payment_status = 'paid', payment_provider = 'cashfree', payment_reference = 'seed_party2', paid_at = now() - interval '1 day' WHERE id = v_party2;

  -- 3. Full pass · Karan · paid (single person, no attendee form)
  SELECT order_id INTO v_full FROM public.create_event_order_checkout(
    'Karan Singh', '9876500002', 'karan@example.com',
    '[{"item_type":"event_package","package_key":"four-intensives-party","quantity":1,"selected_time_slots":[]}]'::jsonb,
    v_hash, 'Pitampura (PP)', '{}'::jsonb);
  UPDATE public.event_orders SET payment_status = 'paid', payment_provider = 'cashfree', payment_reference = 'seed_full', paid_at = now() - interval '20 hours' WHERE id = v_full;

  -- 4. 4 Intensives only · Neha · paid (no party, no coins page access)
  SELECT order_id INTO v_intensive FROM public.create_event_order_checkout(
    'Neha Verma', '9876500003', 'neha@example.com',
    '[{"item_type":"event_package","package_key":"four-intensives","quantity":1,"selected_time_slots":[]}]'::jsonb,
    v_hash, 'Noida Sector 50 (RMG)', '{}'::jsonb);
  UPDATE public.event_orders SET payment_status = 'paid', payment_provider = 'cashfree', payment_reference = 'seed_int', paid_at = now() - interval '6 hours' WHERE id = v_intensive;

  -- 5. Abandoned party checkout · hold expired 40 minutes ago (expiry logic should cancel it)
  SELECT order_id INTO v_abandoned FROM public.create_event_order_checkout(
    'Ghost Buyer', '9876500004', 'ghost@example.com',
    '[{"item_type":"event_package","package_key":"party-entry","quantity":1,"selected_time_slots":[]}]'::jsonb,
    v_hash, 'Not a Student', '{}'::jsonb);
  UPDATE public.event_orders SET created_at = now() - interval '55 minutes', checkout_token_expires_at = now() - interval '40 minutes' WHERE id = v_abandoned;

  -- 6. Karan already has a band (issued "at the intensives") linked to his booking.
  INSERT INTO public.wallets (tag_id, attendee_name, attendee_phone, studio, balance, coin_balance, status, event_order_id)
  VALUES ('NFC0K4R4N', 'Karan Singh', '9876500002', 'PP', 0, 0, 'active', v_full)
  RETURNING id INTO v_wallet;

  -- 7. Karan bought a ₹5,000 pack online AFTER his band was issued → credited straight to the band.
  SELECT id INTO v_pack FROM public.coin_packages WHERE inr_amount = 5000 AND active LIMIT 1;
  SELECT order_id INTO v_coins FROM public.create_coin_order_checkout(
    v_full, 'karan@example.com',
    jsonb_build_array(jsonb_build_object('item_type', 'coin_package', 'coin_package_id', v_pack, 'quantity', 1)),
    v_hash, '{}'::jsonb, v_wallet);
  UPDATE public.event_orders SET payment_status = 'paid', payment_provider = 'cashfree', payment_reference = 'seed_coins_karan', paid_at = now() - interval '3 hours' WHERE id = v_coins;
  PERFORM public.auto_credit_coin_order(v_coins);

  -- 8. Manas bought a ₹2,000 pack BEFORE any band exists → stays prepaid, loads at issue time.
  SELECT id INTO v_pack FROM public.coin_packages WHERE inr_amount = 2000 AND active LIMIT 1;
  SELECT order_id INTO v_coins FROM public.create_coin_order_checkout(
    v_crew, 'manas210890@gmail.com',
    jsonb_build_array(jsonb_build_object('item_type', 'coin_package', 'coin_package_id', v_pack, 'quantity', 1)),
    v_hash, '{}'::jsonb, NULL);
  UPDATE public.event_orders SET payment_status = 'paid', payment_provider = 'cashfree', payment_reference = 'seed_coins_manas', paid_at = now() - interval '1 hour' WHERE id = v_coins;
  PERFORM public.auto_credit_coin_order(v_coins);  -- no band yet → stays prepaid

  RAISE NOTICE 'Seeded. Crew ref % · Party×2 ref % · Full pass ref % (band NFC0K4R4N) · Intensives ref %',
    upper(left(v_crew::TEXT, 8)), upper(left(v_party2::TEXT, 8)), upper(left(v_full::TEXT, 8)), upper(left(v_intensive::TEXT, 8));
END $$;
