import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(p, 'utf8');
const migration = read('supabase/migrations/' + readdirSync('supabase/migrations').find(n => n.endsWith('_safe_wallet_operation_retries.sql')));
const functionSQL = (file, name) => {
  const source = read(file);
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  return source.slice(start, source.indexOf('$$;', start) + 3);
};
const admin = randomUUID(), staff = randomUUID(), other = randomUUID(), wallet = randomUUID(), pack = randomUUID();
const fixture = `
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE profiles(id uuid PRIMARY KEY,role text,allowed boolean DEFAULT true);
INSERT INTO profiles(id,role) VALUES ('${admin}','admin'),('${staff}','staff'),('${other}','admin');
CREATE FUNCTION get_current_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT role FROM public.profiles WHERE id=auth.uid() $$;
CREATE FUNCTION user_has_permission(uuid,text,uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT allowed FROM public.profiles WHERE id=$1 $$;
CREATE TABLE wallets(id uuid PRIMARY KEY,coin_balance int,balance numeric,status text,updated_at timestamptz);
INSERT INTO wallets VALUES('${wallet}',10000,10000,'active',now());
CREATE TABLE coin_packages(id uuid PRIMARY KEY,coin_amount int,inr_amount numeric,active boolean);
INSERT INTO coin_packages VALUES('${pack}',2000,2000,true);
CREATE TABLE transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_id uuid REFERENCES wallets,
  type text,amount numeric,inr_amount numeric,coin_amount int,description text,reference text,game_id uuid,
  item_name text,item_category text,staff_user_id uuid,created_at timestamptz DEFAULT now());
CREATE TABLE game_sales(game_id uuid,transaction_id uuid,quantity int,sale_price numeric,coin_price int);
`;
const spend = {kind:'spend',wallet_id:wallet,coin_amount:750,transaction_type:'food',item_name:'Test food',item_category:'food',game_id:null,reference:'FOOD_TEST via:phone-lookup'};
const topup = (reference) => ({kind:'topup',wallet_id:wallet,coin_package_id:pack,expected_coin_amount:2000,expected_inr_amount:2000,reference});
export { fixture, functionSQL, migration, admin, wallet, pack, spend, topup };

test('wallet retry SQL with real existing spend/credit functions', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    await db.exec(functionSQL('supabase/migrations/20260904000100_harden_wallet_coin_flows.sql','credit_wallet_coins'));
    await db.exec(functionSQL('supabase/migrations/20260906090000_pinkredibles.sql','spend_wallet_coins'));
    // Historical duplicate receipts must survive the migration but remain reserved.
    await db.exec(`INSERT INTO transactions(wallet_id,type,description,reference) VALUES
      ('${wallet}','coin_purchase','Pink''D Coin package purchase',' OLD '),
      ('${wallet}','coin_purchase','Pink''D Coin package purchase','old via:phone-lookup');`);
    await db.exec(migration);
    await db.exec(migration);
    const login = async (who=admin, role='authenticated') => {
      await db.exec('RESET ROLE');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);
      await db.exec(`SET ROLE ${role}`);
    };
    const call = async (id,request=spend) => (await db.query('select public.execute_wallet_operation($1,$2) as result',[id,JSON.stringify(request)])).rows[0].result;
    const balance = async () => {await db.exec('RESET ROLE'); const b=(await db.query(`select coin_balance from wallets where id='${wallet}'`)).rows[0].coin_balance; await login(); return b;};
    await login();
    await t.test('response lost after commit: replay returns exact receipt and debits once',async()=>{
      const id=randomUUID(),before=await balance();
      const first=await call(id);
      assert.equal(first.status,'succeeded');
      assert.deepEqual(await call(id),first);
      assert.equal(await balance(),before-750);
    });
    await t.test('duplicate submitted requests give one transaction (PGlite serializes connections)',async()=>{
      const id=randomUUID(),before=await balance();
      const results=await Promise.all([call(id),call(id),call(id)]);
      assert.equal(new Set(results.map(r=>r.transaction_id)).size,1);
      assert.equal(await balance(),before-750);
    });
    await t.test('changed request and another operator cannot reuse an ID',async()=>{
      const id=randomUUID(); await call(id);
      await assert.rejects(call(id,{...spend,coin_amount:1}),/different operator or payment/);
      await login(other); await assert.rejects(call(id),/different operator or payment/); await login();
    });
    await t.test('permissions are rechecked on successful replay; anon has no RPC or table access',async()=>{
      await login(staff); const id=randomUUID(); await call(id);
      await db.exec(`RESET ROLE; UPDATE profiles SET allowed=false WHERE id='${staff}'`);
      await login(staff); await assert.rejects(call(id),/not assigned/);
      await assert.rejects(call(randomUUID(),topup('staff-denied')),/Only admins/);
      await login('', 'anon'); await assert.rejects(call(randomUUID()),/permission denied/);
      await login(); await assert.rejects(db.query('select * from wallet_operations'),/permission denied/);
      await assert.rejects(db.query('delete from manual_topup_receipts'),/permission denied/);
    });
    await t.test('blocked/insufficient payments are final rejections with no debit',async()=>{
      const before=await balance();
      const id=randomUUID(),request={...spend,coin_amount:100000};
      const rejected=await call(id,request);
      assert.equal(rejected.status,'rejected'); assert.deepEqual(await call(id,request),rejected);
      await db.exec(`RESET ROLE; UPDATE wallets SET status='blocked' WHERE id='${wallet}'`); await login();
      assert.equal((await call(randomUUID())).status,'rejected');
      assert.equal((await call(randomUUID(),topup('blocked-topup'))).status,'rejected');
      await db.exec(`RESET ROLE; UPDATE wallets SET status='active' WHERE id='${wallet}'`); await login();
      assert.equal(await balance(),before);
    });
    await t.test('manual receipt dedupe covers historical, case, whitespace and lookup markers',async()=>{
      const before=await balance(),id=randomUUID();
      const first=await call(id,topup('receipt-1'));
      assert.equal(first.status,'succeeded'); assert.deepEqual(await call(id,topup('receipt-1')),first);
      for(const ref of [' RECEIPT-1 ','\tRECEIPT-1\n','receipt-1 via:phone-lookup','receipt-1 VIA:PHONE-LOOKUP via:phone-lookup\t','old']){
        const r=await call(randomUUID(),topup(ref)); assert.equal(r.status,'rejected'); assert.match(r.message,/already credited/);
      }
      assert.equal(await balance(),before+2000);
      await assert.rejects(db.query('select * from credit_wallet_coins($1,$2,$3)',[wallet,pack,'RECEIPT-1']),/already credited/);
      assert.equal(await balance(),before+2000);
      assert.equal((await call(randomUUID(),topup('receipt-2'))).status,'succeeded');
    });
    await t.test('new package price is rejected; failed insert rolls back wallet and receipt reservation',async()=>{
      const before=await balance();
      assert.equal((await call(randomUUID(),{...topup('changed-price'),expected_inr_amount:1})).status,'rejected');
      await db.exec(`RESET ROLE;
        CREATE FUNCTION fail_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insert rejected'; END $$;
        CREATE TRIGGER zz_test_failure BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION fail_payment();`);
      await login();
      assert.equal((await call(randomUUID(),topup('rollback-receipt'))).status,'rejected');
      assert.equal(await balance(),before);
      await db.exec('RESET ROLE; DROP TRIGGER zz_test_failure ON transactions'); await login();
      assert.equal((await call(randomUUID(),topup('rollback-receipt'))).status,'succeeded');
    });
  } finally { await db.close(); }
});
