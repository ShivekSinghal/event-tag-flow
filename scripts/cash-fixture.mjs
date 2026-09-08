import { readFileSync } from 'node:fs';
export const migration = readFileSync('supabase/migrations/20260907192000_cash_bookings.sql','utf8');
const base = readFileSync('supabase/migrations/20260904100000_automatic_party_phases_and_session_caps.sql','utf8');
export function functionSQL(name) {
  const start = base.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if(start < 0) throw new Error(`Missing ${name}`);
  return base.slice(start,base.indexOf('$$;',start)+3);
}
export const admin='11111111-1111-4111-8111-111111111111', manager='22222222-2222-4222-8222-222222222222', other='33333333-3333-4333-8333-333333333333', staff='44444444-4444-4444-8444-444444444444';
export const studio='Rajouri Garden (RG)', token='a'.repeat(64), code='b'.repeat(64), bad='c'.repeat(64);
export const fixture = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE profiles(id uuid PRIMARY KEY,role text,full_name text,email text);
INSERT INTO profiles VALUES('${admin}','admin','Admin','admin@example.test'),('${manager}','studio_manager','Manager','manager@example.test'),('${other}','studio_manager','Other','other@example.test'),('${staff}','staff','Staff','staff@example.test');
CREATE FUNCTION get_current_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() $$;
CREATE TABLE event_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_name text,customer_phone text,customer_email text,customer_studio text,total_amount_inr numeric,
 payment_provider text DEFAULT 'manual',payment_status text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),paid_at timestamptz,last_payment_verified_at timestamptz,
 checkout_token_hash text,checkout_token_expires_at timestamptz,payment_reference text,attribution jsonb,booking_source text,cashfree_order_id text,razorpay_order_id text,confirmation_email_sent_at timestamptz);
CREATE TABLE event_order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES event_orders,package_key text,package_category text,package_name text,unit_price_inr numeric,quantity int,pax int,line_total_inr numeric,selected_time_slots jsonb,phase_id uuid,phase_name text,phase_price_inr numeric);
CREATE TABLE event_packages(id text PRIMARY KEY,name text,category text,price_inr numeric,intensive_count int,pax int,active boolean,available_from timestamptz);
INSERT INTO event_packages VALUES('party-entry','Party Entry','party',2000,0,1,true,null),('one-intensive','1 Intensive','intensives',1499,1,1,true,null),('crew','Crew','group',30000,4,6,true,null);
CREATE TABLE event_sessions(session_number int PRIMARY KEY,slot_label text,seat_cap int);
INSERT INTO event_sessions VALUES(1,'s1',120),(2,'s2',120),(3,'s3',120),(4,'s4',120);
CREATE TABLE event_pricing_phases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,phase_number int,min_party_count int,party_price_inr numeric,active boolean);
INSERT INTO event_pricing_phases(name,phase_number,min_party_count,party_price_inr,active) VALUES('Phase 1',1,0,2000,true),('Phase 2',2,50,2499,true),('Last Call',3,150,2999,true);
CREATE TABLE event_party_phase_state(id int PRIMARY KEY,highest_phase_number int DEFAULT 1,highest_party_count int DEFAULT 0,updated_at timestamptz);
INSERT INTO event_party_phase_state(id) VALUES(1);
`;
export async function install(db) {
  await db.query(fixture);
  for(const name of ['event_order_is_paid','event_order_hold_is_live','get_party_entry_counts','get_session_seat_counts','get_party_phase_for_count','resolve_party_phase','create_event_order']) await db.query(functionSQL(name));
  await db.query(readFileSync('supabase/migrations/20260903082000_shorten_event_checkout_hold_to_15_minutes.sql','utf8'));
  await db.query(migration);
  await db.query('INSERT INTO cash_manager_studios VALUES($1,$2),($3,$4)',[manager,studio,other,'Dwarka (DWK)']);
}
export const request = (items=[{item_type:'event_package',package_key:'party-entry',quantity:1,selected_time_slots:[]}]) => ({customer_name:'Test Guest',customer_phone:'9000000000',customer_email:'guest@example.test',customer_studio:'Not a Student',cash_studio:studio,cart_items:items,attribution:{}});
