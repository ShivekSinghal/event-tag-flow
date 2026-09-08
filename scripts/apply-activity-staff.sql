-- Release-only: run with a trusted database administrator AFTER the migration,
-- preview approval, and Akash's verified staff-account provisioning. Atomic and retryable.
BEGIN;
CREATE TEMP TABLE activity_roster(email text PRIMARY KEY, groups text[]) ON COMMIT DROP;
INSERT INTO activity_roster VALUES
 ('asthat2716@gmail.com', ARRAY['tier_1']),
 ('khanduja.dhriti04@gmail.com', ARRAY['tier_1']),
 ('rubanimay01@gmail.com', ARRAY['tier_2']),
 ('ahujatarun29@gmail.com', ARRAY['tier_2']),
 ('jahnvi.ydv48@gmail.com', ARRAY['tier_2']),
 ('divijamalhotra@gmail.com', ARRAY['tier_3']),
 ('priyanshiikamboj05@gmail.com', ARRAY['tier_3']),
 ('ayushi.pathania@gmail.com', ARRAY['free','donations']),
 ('thakur.akash4796@gmail.com', ARRAY['free','donations']);
CREATE TEMP TABLE activity_manifest(name text PRIMARY KEY, grp text, coins numeric, mode text) ON COMMIT DROP;
INSERT INTO activity_manifest VALUES
 ('Shoot Your Shot','tier_1',450,'fixed'), ('Spin the Wheel','tier_1',450,'fixed'),
 ('Wing Person for Hire','tier_1',450,'fixed'), ('Hurdle','tier_2',750,'fixed'),
 ('Cricket','tier_2',750,'fixed'), ('Issue With a Tissue','tier_2',750,'fixed'),
 ('Limbo','tier_3',1000,'fixed'), ('Bombastic','tier_3',1000,'fixed'),
 ('Minute to Win It','tier_3',1000,'fixed'), ('Red Flag Green Flag','free',0,'free'),
 ('Jamaal Challenge','free',0,'free'), ('Squid Games','free',0,'free'), ('Beer Pong','free',0,'free'),
 ('Karaoke','donations',150,'donation'), ('Busk for a Cause','donations',150,'donation');
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM activity_roster r LEFT JOIN public.profiles p ON lower(p.email)=r.email
    GROUP BY r.email HAVING count(p.id)<>1 OR bool_and(p.role='staff') IS NOT TRUE) THEN
    RAISE EXCEPTION 'Every named operator must have exactly one existing staff-only profile';
  END IF;
  IF EXISTS (SELECT 1 FROM activity_manifest m LEFT JOIN public.games g ON lower(trim(g.name))=lower(m.name) AND g.available
    GROUP BY m.name HAVING count(g.id)<>1 OR bool_and(g.activity_group=m.grp AND g.price=m.coins AND g.pricing_mode=m.mode) IS NOT TRUE) THEN
    RAISE EXCEPTION 'Expected fifteen canonical active activities with the approved prices and groups';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_permissions s JOIN public.profiles p ON p.id=s.user_id
    WHERE lower(p.email)='tarun@hashtag.dance') THEN
    RAISE EXCEPTION 'Tarun work account has permissions; review separately rather than silently removing unrelated access';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(email)='singhalshivek24@gmail.com' AND role='admin') THEN
    RAISE EXCEPTION 'Owner admin must remain unchanged';
  END IF;
END $$;

-- Only this roster's assignments to the fifteen managed activities are replaced.
-- Other accounts, role settings, cash-manager studios, and unrelated permissions are untouched.
DELETE FROM public.staff_permissions s USING public.profiles p, public.games g, activity_manifest m, activity_roster r
WHERE s.user_id=p.id AND lower(p.email)=r.email AND s.permission_type='game'
  AND s.game_id=g.id AND lower(trim(g.name))=lower(m.name);
INSERT INTO public.staff_permissions(user_id,permission_type,game_id)
SELECT p.id,'game',g.id FROM activity_roster r
JOIN public.profiles p ON lower(p.email)=r.email
JOIN public.games g ON g.available AND g.activity_group=ANY(r.groups)
JOIN activity_manifest m ON lower(trim(g.name))=lower(m.name);
SELECT p.email, g.name, g.activity_group FROM public.staff_permissions s
JOIN public.profiles p ON p.id=s.user_id JOIN public.games g ON g.id=s.game_id
JOIN activity_roster r ON lower(p.email)=r.email ORDER BY p.email,g.name;
COMMIT;
