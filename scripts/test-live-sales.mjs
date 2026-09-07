import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';

const migration = readFileSync(`supabase/migrations/${readdirSync('supabase/migrations').find((name) => name.endsWith('_add_event_live_sales.sql'))}`, 'utf8');
const labels = ['Wednesday, Sept 9 @ 6:00 PM', 'Wednesday, Sept 9 @ 8:00 PM', 'Thursday, Sept 10 @ 6:00 PM', 'Thursday, Sept 10 @ 8:00 PM'];
const admin = '00000000-0000-0000-0000-000000000001';
const staff = '00000000-0000-0000-0000-000000000002';
const manager = '00000000-0000-0000-0000-000000000003';
const fixture = `
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text);
INSERT INTO public.profiles VALUES ('${admin}','admin'),('${staff}','staff'),('${manager}','studio_manager');
CREATE FUNCTION public.get_current_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS
  $$ SELECT role FROM public.profiles WHERE id=auth.uid() $$;
CREATE TABLE public.event_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_status text,
  created_at timestamptz DEFAULT now(), checkout_token_expires_at timestamptz);
CREATE TABLE public.event_order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES public.event_orders,
  package_key text, package_category text, quantity int, pax int, line_total_inr numeric(10,2), selected_time_slots jsonb);
CREATE TABLE public.event_sessions (session_number int PRIMARY KEY,slot_label text UNIQUE,seat_cap int);
ALTER TABLE public.event_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sessions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.event_orders, public.event_order_items, public.event_sessions TO authenticated;
CREATE POLICY orders_admin ON public.event_orders FOR SELECT TO authenticated USING (public.get_current_user_role()='admin');
CREATE POLICY items_admin ON public.event_order_items FOR SELECT TO authenticated USING (public.get_current_user_role()='admin');
CREATE POLICY sessions_public ON public.event_sessions FOR SELECT TO authenticated USING (true);
`;

async function database() {
  const db = new PGlite();
  await db.exec(fixture);
  for (const [i, label] of labels.entries()) await db.query('INSERT INTO public.event_sessions VALUES ($1,$2,120)', [i + 1, label]);
  await db.exec(migration);
  return db;
}

async function order(db, items, status = 'paid', expiry = null, created = new Date().toISOString()) {
  const { rows: [row] } = await db.query('INSERT INTO public.event_orders(payment_status,checkout_token_expires_at,created_at) VALUES($1,$2,$3) RETURNING id', [status, expiry, created]);
  for (const item of items) {
    await db.query('INSERT INTO public.event_order_items(order_id,package_key,package_category,quantity,pax,line_total_inr,selected_time_slots) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [row.id, item.key, item.category, item.quantity ?? 1, item.pax ?? null, item.price ?? 100, JSON.stringify(item.slots ?? [])]);
  }
  return row.id;
}

async function report(db, user = admin, role = 'authenticated') {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`SET ROLE ${role}`);
  try {
    const { rows } = await db.query('SELECT public.get_event_live_sales() AS report');
    return rows[0].report;
  } finally { await db.exec('RESET ROLE'); }
}
const full = { key: 'four-intensives-party', category: 'package', slots: labels, price: 5500 };

test('live sales SQL: package expansion, money, expiry, refunds, data quality and RLS', async (t) => {
  const db = await database();
  try {
    await t.test('empty is a genuine zero snapshot with four database labels', async () => {
      const r = await report(db);
      assert.deepEqual(r.sessions.map((s) => s.label), labels);
      assert.equal(r.sessions.every((s) => s.sold === 0 && s.on_hold === 0 && s.available === 120), true);
      assert.equal(r.totals.paid_orders, 0);
      assert.equal(r.totals.event_revenue_inr, 0);
    });
    await t.test('full pass: five admissions, one order, one price; duplicate notifications do not add sales', async () => {
      const id = await order(db, [full]);
      const first = await report(db);
      assert.deepEqual(first.sessions.map((s) => s.sold), [1, 1, 1, 1]);
      assert.deepEqual(first.totals, { paid_orders: 1, event_revenue_inr: 5500, intensive_admissions: 4, party_admissions: 1, total_admissions: 5 });
      await db.query("UPDATE public.event_orders SET payment_status='paid' WHERE id=$1", [id]);
      assert.deepEqual((await report(db)).totals, first.totals);
    });
    await t.test('all seven packages, quantity and crew pax; coin revenue excluded from mixed carts', async () => {
      await order(db, [
        { key: 'one-intensive', category: 'intensives', quantity: 2, slots: [labels[0]], price: 2998 },
        { key: 'two-intensives', category: 'intensives', slots: [labels[1], labels[3]], price: 2699 },
        { key: 'four-intensives', category: 'intensives', slots: labels, price: 4499 },
        { key: 'party-entry', category: 'party', quantity: 3, price: 6000 },
        { key: 'six-pax-four-intensives-party', category: 'group', pax: 6, quantity: 2, slots: labels, price: 60000 },
        { key: 'ten-pax-four-intensives-party', category: 'group', pax: 10, slots: labels, price: 48000 },
        { key: 'coin-package:2000', category: 'coins', quantity: 5, slots: labels, price: 10000 },
      ], 'completed');
      await order(db, [{ key: 'coin-package:5000', category: 'coins', price: 5000 }]);
      const r = await report(db);
      assert.deepEqual(r.sessions.map((s) => s.sold), [26, 25, 24, 25]);
      assert.equal(r.party.sold, 26);
      assert.equal(r.totals.total_admissions, 126);
      assert.equal(r.totals.paid_orders, 2);
      assert.equal(r.totals.event_revenue_inr, 129696);
      assert.equal(Object.values(r.warnings).some(Boolean), false);
    });
    await t.test('holds are separate, expire without writes, and never increase revenue', async () => {
      const before = await report(db);
      const future = new Date(Date.now() + 600000).toISOString();
      const past = new Date(Date.now() - 600000).toISOString();
      const hold = await order(db, [full], 'pending', future);
      await order(db, [full], 'manual_payment', future);
      await order(db, [full], 'pending', past);
      await order(db, [full], 'manual_payment', null, new Date(Date.now() - 16 * 60000).toISOString());
      const r = await report(db);
      assert.equal(r.party.on_hold, 2);
      assert.deepEqual(r.sessions.map((s) => s.on_hold), [2, 2, 2, 2]);
      assert.deepEqual(r.totals, before.totals);
      await db.query('UPDATE public.event_orders SET checkout_token_expires_at=$1 WHERE id=$2', [past, hold]);
      assert.equal((await report(db)).party.on_hold, 1);
      const stored = await db.query('SELECT payment_status FROM public.event_orders WHERE id=$1', [hold]);
      assert.equal(stored.rows[0].payment_status, 'pending');
      await db.query("UPDATE public.event_orders SET payment_status='paid' WHERE id=$1", [hold]);
      const paid = await report(db);
      assert.equal(paid.party.sold, before.party.sold + 1);
      assert.equal(paid.totals.event_revenue_inr, before.totals.event_revenue_inr + 5500);
      await db.query("UPDATE public.event_orders SET payment_status='refunded' WHERE id=$1", [hold]);
      assert.deepEqual((await report(db)).totals, before.totals);
    });
    await t.test('failed, cancelled and refunded orders are not sales or active holds', async () => {
      const before = await report(db);
      for (const status of ['failed', 'cancelled', 'refunded']) await order(db, [full], status, new Date(Date.now() + 600000).toISOString());
      const after = await report(db);
      assert.deepEqual(after.totals, before.totals);
      assert.deepEqual(after.party, before.party);
    });
    await t.test('invalid assignments warn, duplicate slots cannot double count, missing slots are not guessed', async () => {
      await order(db, [
        { ...full, slots: [] },
        { key: 'two-intensives', category: 'intensives', slots: [labels[0], 'unknown slot'] },
        { key: 'one-intensive', category: 'intensives', slots: [labels[0], labels[0]] },
        { key: 'one-intensive', category: 'intensives', slots: { unexpected: true } },
        { key: 'new-package', category: 'intensives', slots: [labels[0]] },
        { key: 'six-pax-four-intensives-party', category: 'group', slots: labels },
      ]);
      const r = await report(db);
      assert.equal(r.warnings.session_assignment_items, 4);
      assert.equal(r.warnings.unknown_package_items, 1);
      assert.equal(r.warnings.pax_items, 1);
      await db.exec('DELETE FROM public.event_sessions WHERE session_number=4');
      assert.equal((await report(db)).warnings.incomplete_session_catalog, true);
      await db.query('INSERT INTO public.event_sessions VALUES(4,$1,120)', [labels[3]]);
    });
    await t.test('more than 1,000 orders are aggregated in SQL, availability never negative', async () => {
      const before = await report(db);
      await db.exec(`WITH new_orders AS (
        INSERT INTO public.event_orders(payment_status) SELECT 'paid' FROM generate_series(1,1005) RETURNING id
      ) INSERT INTO public.event_order_items(order_id,package_key,package_category,quantity,line_total_inr,selected_time_slots)
        SELECT id,'party-entry','party',1,2000,'[]'::jsonb FROM new_orders`);
      await order(db, [{ key: 'four-intensives', category: 'intensives', quantity: 200, slots: labels, price: 100 }]);
      const after = await report(db);
      assert.equal(after.totals.paid_orders, before.totals.paid_orders + 1006);
      assert.equal(after.party.sold, before.party.sold + 1005);
      assert.equal(after.sessions.every((s) => s.available === 0), true);
    });
    await t.test('invoker privileges and admin role are enforced for every call', async () => {
      const attrs = await db.query("SELECT prosecdef,provolatile FROM pg_proc WHERE oid='public.get_event_live_sales()'::regprocedure");
      assert.equal(attrs.rows[0].prosecdef, false);
      assert.equal(attrs.rows[0].provolatile, 's');
      await assert.rejects(report(db, '', 'anon'), /permission denied/);
      for (const user of ['', staff, manager, '00000000-0000-0000-0000-000000000099']) {
        await assert.rejects(report(db, user), /Admin access required/);
      }
      // Revoking table access also blocks the RPC: it cannot bypass RLS/table permissions.
      await db.exec('REVOKE SELECT ON public.event_order_items FROM authenticated');
      await assert.rejects(report(db), /permission denied/);
      await db.exec('GRANT SELECT ON public.event_order_items TO authenticated');
      assert.ok((await report(db)).totals.paid_orders > 0);
    });
  } finally { await db.close(); }
});

const require = createRequire(import.meta.url);
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/eventLiveSales.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { require, module, exports: module.exports });
const { parseEventLiveSales } = module.exports;

test('client rejects missing/malformed snapshots rather than displaying invented zeros', () => {
  for (const value of [null, {}, { sessions: [] }, { generated_at: 'not-a-date' }]) {
    assert.throws(() => parseEventLiveSales(value), /incomplete or inconsistent/);
  }
});
