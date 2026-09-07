import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { fixture, functionSQL, migration, admin, wallet } from './test-wallet-retries.mjs';

const runtime=process.env.PINKD_EMBEDDED_POSTGRES_ROOT;
test('direct awards: independent PostgreSQL sessions and unchanged redemption', {skip:!runtime,timeout:90000},async t=>{
  const {default: EmbeddedPostgres}=await import(pathToFileURL(path.join(runtime,'node_modules/embedded-postgres/dist/index.js')));
  const dir=await mkdtemp(path.join(tmpdir(),'pinkd-awards-pg-'));
  const server=new EmbeddedPostgres({databaseDir:path.join(dir,'db'),user:'postgres',password:randomUUID(),port:55444,persistent:false,postgresFlags:['-h','127.0.0.1','-k',dir],onLog:()=>{},onError:()=>{}});
  const clients=[]; const game=randomUUID(),manager=randomUUID(),staff=randomUUID();
  try {
    await server.initialise();await server.start();
    for(let i=0;i<4;i++){const c=server.getPgClient();await c.connect();clients.push(c);}
    const [owner,a,b,c]=clients;await owner.query(fixture);
    await owner.query(`CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public,auth TO service_role;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
      CREATE TABLE games(id uuid PRIMARY KEY,name text,available boolean,awards_pinkredible boolean);
      CREATE TABLE staff_permissions(user_id uuid,game_id uuid,permission_type text);
      CREATE TABLE game_round_players(transaction_id uuid);
      CREATE TABLE game_rounds(id uuid PRIMARY KEY,game_id uuid);
      ALTER TABLE wallets ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE wallets ADD COLUMN pinkredible_balance int NOT NULL DEFAULT 0 CHECK(pinkredible_balance>=0),ADD COLUMN pinkredible_code text UNIQUE,ADD COLUMN attendee_name text DEFAULT 'Test Guest',ADD COLUMN attendee_phone text,ADD COLUMN tag_id text,ADD COLUMN studio text,ADD COLUMN event_order_id uuid;
      CREATE TABLE pinkredible_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_id uuid REFERENCES wallets,delta int,kind text,game_name text,note text,round_id uuid,staff_user_id uuid REFERENCES profiles,created_at timestamptz DEFAULT now());
      ALTER TABLE pinkredible_ledger ENABLE ROW LEVEL SECURITY; GRANT SELECT ON pinkredible_ledger TO authenticated;
      CREATE POLICY ledger_admin ON pinkredible_ledger FOR SELECT TO authenticated USING(get_current_user_role() IN ('admin','studio_manager'));`);
    await owner.query('INSERT INTO games VALUES($1,$2,true,true)',[game,'Cricket']);
    await owner.query("INSERT INTO profiles(id,role) VALUES($1,'studio_manager'),($2,'staff')",[manager,staff]);
    await owner.query("INSERT INTO staff_permissions VALUES($1,$3,'game'),($2,$3,'game')",[manager,staff,game]);
    await owner.query(functionSQL('supabase/migrations/20260904000100_harden_wallet_coin_flows.sql','credit_wallet_coins'));
    const pink='supabase/migrations/20260906090000_pinkredibles.sql';
    for(const fn of ['spend_wallet_coins','pinkredible_value_inr','pinkredible_expires_at','generate_pinkredible_code','check_pinkredible_code','redeem_pinkredibles','_reissue_wallet_unchecked']) await owner.query(functionSQL(pink,fn));
    await owner.query(migration);
    await owner.query(readFileSync('supabase/migrations/20260907184809_pos_sale_void_controls.sql','utf8'));
    await owner.query(readFileSync('supabase/migrations/20260907191000_pinkredibles_award.sql','utf8'));
    const login=async(client,who=admin)=>{await client.query('RESET ROLE');await client.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[who]);await client.query('SET ROLE authenticated');};
    await login(a);await login(b,manager);await login(c,staff);
    const buy=async(client=a,wid=wallet)=>{const r=await client.query('SELECT execute_wallet_operation($1,$2) r',[randomUUID(),JSON.stringify({kind:'spend',wallet_id:wid,coin_amount:750,transaction_type:'games',item_name:'Cricket',item_category:'games',game_id:game,reference:'GAME_TEST via:phone-lookup'})]);assert.equal(r.rows[0].r.status,'succeeded');return r.rows[0].r.transaction_id;};
    const req=tid=>({wallet_id:wallet,game_id:game,entry_transaction_id:tid});
    const award=(client,id,request)=>client.query('SELECT award_pinkredible($1,$2) r',[id,JSON.stringify(request)]).then(r=>r.rows[0].r);
    const reverse=(client,tid)=>client.query('SELECT void_pos_sale($1,$2) r',[randomUUID(),JSON.stringify({kind:'void',wallet_id:wallet,sale_transaction_id:tid,void_reason:'Wrong game'})]).then(r=>r.rows[0].r);
    const cool=()=>owner.query("UPDATE pinkredible_ledger SET created_at=now()-interval '3 minutes' WHERE kind='award'");
    let receipt,firstEntry;
    await t.test('winner must have a real eligible payment',async()=>{
      assert.equal((await award(a,randomUUID(),req(randomUUID()))).status,'rejected');
      firstEntry=await buy();
      const eligible=(await a.query('SELECT eligible_pinkredible_entries($1,$2) r',[wallet,game])).rows[0].r;
      assert.equal(eligible[0].transaction_id,firstEntry);
    });
    await t.test('lost response and concurrent matching retries award exactly once',async()=>{
      const id=randomUUID();await a.query('BEGIN');receipt=await award(a,id,req(firstEntry));assert.equal(receipt.status,'succeeded');
      await login(b);let settled=false;const waiting=award(b,id,req(firstEntry)).then(r=>{settled=true;return r;});
      await new Promise(r=>setTimeout(r,100));assert.equal(settled,false);await a.query('COMMIT');assert.deepEqual(await waiting,receipt);
      await cool();assert.deepEqual(await award(a,id,req(firstEntry)),receipt,'retry after cooldown returns original award');
      await assert.rejects(award(a,id,{...req(firstEntry),entry_transaction_id:randomUUID()}),/different operator/);
      await login(b,manager);await assert.rejects(award(b,id,req(firstEntry)),/different operator/);
      assert.equal((await owner.query('SELECT pinkredible_balance FROM wallets WHERE id=$1',[wallet])).rows[0].pinkredible_balance,1);
    });
    await t.test('one entry cannot win twice, and an awarded entry cannot be voided',async()=>{
      assert.equal((await award(a,randomUUID(),req(firstEntry))).status,'rejected');
      assert.equal((await reverse(a,firstEntry)).status,'rejected');
      const entry=await buy();await reverse(a,entry);assert.equal((await award(a,randomUUID(),req(entry))).status,'rejected');
    });
    await t.test('cooldown spans operators and different paid entries; concurrent awards serialize',async()=>{
      const one=await buy(),two=await buy();await cool();
      await a.query('BEGIN');assert.equal((await award(a,randomUUID(),req(one))).status,'succeeded');
      const other=award(b,randomUUID(),req(two));await a.query('COMMIT');assert.match((await other).message,/two minutes/);
    });
    await t.test('void versus award serializes on original payment',async()=>{
      const entry=await buy();await cool();await a.query('BEGIN');assert.equal((await reverse(a,entry)).status,'succeeded');
      const wait=award(b,randomUUID(),req(entry));await a.query('COMMIT');assert.equal((await wait).status,'rejected');
    });
    await t.test('staff and managers require assignments; disabled prize games and blocked bands fail',async()=>{
      const entry=await buy();await cool();
      await owner.query('DELETE FROM staff_permissions WHERE user_id=$1',[manager]);
      await assert.rejects(award(b,randomUUID(),req(entry)),/not assigned/);
      await owner.query('UPDATE games SET available=false WHERE id=$1',[game]);await assert.rejects(award(a,randomUUID(),req(entry)),/active prize/);
      await owner.query('UPDATE games SET available=true WHERE id=$1',[game]);
      await owner.query("UPDATE wallets SET status='blocked' WHERE id=$1",[wallet]);assert.equal((await award(a,randomUUID(),req(entry))).status,'rejected');
      await owner.query("UPDATE wallets SET status='active' WHERE id=$1",[wallet]);
      assert.deepEqual((await c.query('SELECT * FROM pinkredible_ledger')).rows,[]);
      await c.query('RESET ROLE');await c.query('SET ROLE anon');await assert.rejects(award(c,randomUUID(),req(entry)),/permission denied/);await login(c,staff);
    });
    await t.test('expired rewards reject new awards without consuming a paid entry',async()=>{
      const entry=await buy();await cool();
      await owner.query('BEGIN');
      try {
        await owner.query("CREATE OR REPLACE FUNCTION public.pinkredible_expires_at() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT '2020-01-01'::timestamptz $$");
        await owner.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[admin]);
        assert.match((await award(owner,randomUUID(),req(entry))).message,/expired/);
        assert.equal((await owner.query('SELECT count(*)::int n FROM pinkredible_ledger WHERE entry_transaction_id=$1',[entry])).rows[0].n,0);
      } finally { await owner.query('ROLLBACK'); }
    });
    await t.test('public coupon contract and service-role redemption remain intact',async()=>{
      const info=(await a.query('SELECT check_pinkredible_code($1) r',[receipt.code])).rows[0].r;
      assert.equal(info.valid,true);assert.equal(info.value_inr,info.pinkredibles*100);assert.equal('band_hint' in info,false);
      await c.query('RESET ROLE');await c.query("SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claim.role','service_role',false)");await c.query('SET ROLE service_role');
      const redeemed=(await c.query('SELECT redeem_pinkredibles($1,1,$2) r',[receipt.code,'Server registration'])).rows[0].r;assert.equal(redeemed.redeemed,1);
      await assert.rejects(c.query('SELECT redeem_pinkredibles($1,999,null)',[receipt.code]),/Only/);
      const moved=(await a.query("SELECT _reissue_wallet_unchecked($1,'NFC04ABCD11223344','lost') r",[wallet])).rows[0].r;
      assert.equal(moved.moved_pinkredibles,info.pinkredibles-1);
      assert.equal((await a.query('SELECT check_pinkredible_code($1) r',[receipt.code])).rows[0].r.valid,true);
    });
  } finally {for(const client of clients) await client.end();await server.stop();}
});
