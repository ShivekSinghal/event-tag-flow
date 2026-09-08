import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const admin = '00000000-0000-0000-0000-000000000001';
const staff = '00000000-0000-0000-0000-000000000002';
const manager = '00000000-0000-0000-0000-000000000003';
const sql = readFileSync(`supabase/migrations/${readdirSync('supabase/migrations').find(n => n.endsWith('_event_admission_roster_and_checkin.sql'))}`, 'utf8');
const liveSql = readFileSync(`supabase/migrations/${readdirSync('supabase/migrations').find(n => n.endsWith('_add_event_live_sales.sql'))}`, 'utf8');
async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY, role text, full_name text);
    INSERT INTO profiles VALUES ('${admin}','admin','Admin'),('${staff}','staff','Staff'),('${manager}','studio_manager','Manager');
    CREATE FUNCTION get_current_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() $$;
    CREATE TABLE event_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_name text DEFAULT 'Buyer',
      customer_phone text DEFAULT '9999999999', customer_email text DEFAULT 'buyer@example.com', customer_studio text,
      payment_status text DEFAULT 'paid', payment_provider text DEFAULT 'cashfree', created_at timestamptz DEFAULT now(), checkout_token_expires_at timestamptz);
    CREATE TABLE event_order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES event_orders,
      package_name text DEFAULT 'Pass', package_key text, package_category text, quantity int DEFAULT 1,pax int,
      created_at timestamptz DEFAULT now(), selected_time_slots jsonb DEFAULT '[]', line_total_inr numeric DEFAULT 100);
    CREATE TABLE event_sessions(session_number int PRIMARY KEY, slot_label text,seat_cap int DEFAULT 120);
    INSERT INTO event_sessions(session_number,slot_label) VALUES(1,'Slot 1'),(2,'Slot 2'),(3,'Slot 3'),(4,'Slot 4');
    CREATE TABLE event_order_attendees(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES event_orders,
      position int,attendee_name text,attendee_phone text, UNIQUE(order_id,position));
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    ALTER TABLE event_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE event_order_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE event_order_attendees ENABLE ROW LEVEL SECURITY;
    CREATE POLICY orders_admin ON event_orders FOR SELECT TO authenticated USING(get_current_user_role()='admin');
    CREATE POLICY items_admin ON event_order_items FOR SELECT TO authenticated USING(get_current_user_role()='admin');
    CREATE POLICY attendees_admin ON event_order_attendees FOR SELECT TO authenticated USING(get_current_user_role()='admin');
  `);
  await db.exec(sql); await db.exec(liveSql);
  return db;
}
async function asUser(db, user, sql, params = [], role = 'authenticated') {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`SET ROLE ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('RESET ROLE'); }
}
const report = async (db, event = null) => (await asUser(db, admin, 'SELECT get_event_admission_report($1) AS r', [event])).rows[0].r;
async function order(db, studio, items, status = 'paid') {
  const id = (await db.query('INSERT INTO event_orders(customer_studio,payment_status) VALUES($1,$2) RETURNING id', [studio, status])).rows[0].id;
  const ids = [];
  for (const [index, item] of items.entries()) {
    ids.push((await db.query(`INSERT INTO event_order_items(order_id,package_category,package_key,quantity,pax,selected_time_slots,created_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+$7*interval '1 second') RETURNING id`,
      [id,item.category,item.key,item.quantity ?? 1,item.pax ?? 1,JSON.stringify(item.slots ?? []),index])).rows[0].id);
  }
  return { id, ids };
}
const check = async (db, item, seat, event, value = true, timestamp = null, name = null, phone = null, user = admin) =>
  (await asUser(db, user, 'SELECT set_event_admission_checkin($1,$2,$3,$4,$5,$6,$7) AS r', [item,seat,event,value,timestamp,name,phone])).rows[0].r;

test('attendance roster, studio counts, check-in and authorization', async t => {
  const db = await setup();
  const full = { category:'package',key:'four-intensives-party',slots:['Slot 1','Slot 2','Slot 3','Slot 4'] };
  try {
    const solo = await order(db,'NDA',[{category:'intensives',key:'one-intensive',slots:['Slot 1','Slot 1']}]);
    const crew = await order(db,'RMG',[{...full,category:'group',key:'six-pax-four-intensives-party',pax:6}]);
    await db.query("INSERT INTO event_order_attendees(order_id,position,attendee_name,attendee_phone) VALUES($1,1,'Guest One','8888888888'),($1,2,'Guest Two','7777777777')", [crew.id]);
    const mixed = await order(db,null,[{category:'intensives',key:'one-intensive',slots:['Slot 1']},{category:'party',key:'party-entry',quantity:2}]);
    await db.query("INSERT INTO event_order_attendees(order_id,position,attendee_name,attendee_phone) VALUES($1,1,'Party Guest','6666666666')",[mixed.id]);
    const pending = await order(db,'NDA',[full],'pending');
    await order(db,'NDA',[full],'refunded');
    await order(db,'NDA',[{category:'coins',key:'coins',slots:['Slot 1']}]);
    await t.test('matches live sales: crew expansion, duplicate slots, mixed carts and studios',async()=>{
      const r = await report(db,1);
      assert.equal(r.attendees.length,8);
      assert.equal(r.attendees.find(x=>x.item_id===solo.ids[0]).attendee_name,'Buyer');
      assert.equal(r.attendees.find(x=>x.item_id===crew.ids[0]&&x.admission_index===1).attendee_name,'Guest One');
      assert.equal(r.attendees.find(x=>x.item_id===mixed.ids[0]).attendee_name,null,'do not attach party guest to intensive-only line');
      assert.equal((await report(db,0)).attendees.find(x=>x.item_id===mixed.ids[1]&&x.admission_index===1).attendee_name,'Party Guest');
      assert.equal(r.studios.find(x=>x.event_number===1&&x.studio==='Not specified').sold,1);
      const live=(await asUser(db,admin,'SELECT get_event_live_sales() AS r')).rows[0].r;
      for(const session of live.sessions) assert.equal(r.studios.filter(s=>s.event_number===session.session_number).reduce((n,s)=>n+s.sold,0),session.sold);
      assert.equal((await report(db)).attendees.length,0);
    });
    let first;
    await t.test('check-in is persistent, repeat-safe, and separate per event/seat',async()=>{
      first=await check(db,crew.ids[0],1,1);
      assert.ok(first.checked_in_at);
      const again=await check(db,crew.ids[0],1,1);
      assert.equal(again.checked_in_at,first.checked_in_at);
      assert.equal((await report(db,2)).attendees.filter(x=>x.checked_in_at).length,0);
      assert.equal((await report(db,1)).attendees.filter(x=>x.checked_in_at).length,1);
      assert.equal((await db.query('SELECT count(*)::int n FROM event_admission_checkins')).rows[0].n,1);
      await assert.rejects(check(db,crew.ids[0],7,1),/No paid admission/);
      await assert.rejects(check(db,pending.ids[0],1,1),/No paid admission/);
      await assert.rejects(check(db,solo.ids[0],1,2),/No paid admission/);
    });
    await t.test('missing identities must be captured and do not alter booking/attendee/payment data',async()=>{
      await assert.rejects(check(db,crew.ids[0],3,1),/Guest name/);
      const saved=await check(db,crew.ids[0],3,1,true,null,'Guest Three','5555555555');
      assert.equal(saved.attendee_name,'Guest Three');
      assert.equal((await db.query('SELECT count(*)::int n FROM event_order_attendees WHERE order_id=$1',[crew.id])).rows[0].n,2);
      assert.equal((await db.query('SELECT payment_status FROM event_orders WHERE id=$1',[crew.id])).rows[0].payment_status,'paid');
    });
    await t.test('undo is audited and stale undo cannot erase a newer check-in',async()=>{
      await assert.rejects(check(db,crew.ids[0],1,1,false,'2000-01-01T00:00:00Z'),/another device/);
      const undone=await check(db,crew.ids[0],1,1,false,first.checked_in_at);
      assert.equal(undone.checked_in_at,null);
      assert.equal((await check(db,crew.ids[0],1,1,false,first.checked_in_at)).checked_in_at,null);
      assert.ok((await db.query('SELECT undone_by FROM event_admission_checkins WHERE item_id=$1 AND admission_index=1',[crew.ids[0]])).rows[0].undone_by);
      await check(db,crew.ids[0],1,1);
      await assert.rejects(check(db,crew.ids[0],1,1,false,first.checked_in_at),/another device/);
    });
    await t.test('anonymous, staff, managers cannot read roster or mutate attendance',async()=>{
      for(const user of [staff,manager,'']) {
        await assert.rejects(asUser(db,user,'SELECT get_event_admission_report()'),/Admin access/);
        await assert.rejects(check(db,solo.ids[0],1,1,true,null,null,null,user),/Admin access/);
        assert.equal((await asUser(db,user,'SELECT * FROM event_admission_roster')).rows.length,0);
        assert.equal((await asUser(db,user,'SELECT * FROM event_admission_checkins')).rows.length,0);
      }
      await assert.rejects(asUser(db,'','SELECT get_event_admission_report()',[],'anon'),/permission denied/);
      await assert.rejects(asUser(db,'','SELECT * FROM event_admission_roster',[],'anon'),/permission denied/);
      await assert.rejects(asUser(db,admin,'DELETE FROM event_admission_checkins'),/permission denied/);
      await db.query("UPDATE profiles SET role='staff' WHERE id=$1",[admin]);
      await assert.rejects(check(db,solo.ids[0],1,1),/Admin access/);
    });
  } finally { await db.close(); }
});
