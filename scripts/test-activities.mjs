import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import { fixture, functionSQL, migration as retries, admin, wallet } from './test-wallet-retries.mjs';

const source = readFileSync('src/lib/activities.ts', 'utf8');
const { parseDonationCoins } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { module: ts.ModuleKind.ESNext })).toString('base64'));
const activityMigration = readFileSync('supabase/migrations/' + readdirSync('supabase/migrations').find(n => n.endsWith('_activity_groups_and_donations.sql')), 'utf8');
const assignments = readFileSync('scripts/apply-activity-staff.sql', 'utf8');
const roster = [...assignments.matchAll(/\('([^']+@[^']+)', ARRAY\[([^\]]+)\]\)/g)].map(m => ({ email: m[1], groups: [...m[2].matchAll(/'([^']+)'/g)].map(g => g[1]) }));
const manifest = [...assignments.matchAll(/\('([^']+)','(tier_\d|free|donations)',(\d+),'(fixed|free|donation)'\)/g)].map(m => ({ id: randomUUID(), name: m[1], group: m[2], price: Number(m[3]), mode: m[4] }));

test('donation UI accepts only bounded whole coins at or above the configured minimum', () => {
  for (const bad of ['', ' ', '-1', '0', '149', '150.5', '150.0', '1e3', '150abc', '2147483648']) assert.equal(parseDonationCoins(bad, 150), null, bad);
  for (const good of ['150', '151', '999', ' 200 ']) assert.equal(parseDonationCoins(good, 150), Number(good));
  assert.equal(parseDonationCoins('199', 200), null);
  assert.equal(parseDonationCoins('200', 200), 200);
});

test('activity migration, assignment release and wallet enforcement in PostgreSQL', async t => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    await db.exec(`ALTER TABLE profiles ADD COLUMN email text;
      UPDATE profiles SET email='singhalshivek24@gmail.com' WHERE id='${admin}';
      CREATE TABLE games(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,description text,studio text,price numeric,
        available boolean DEFAULT true,awards_pinkredible boolean DEFAULT false,created_at timestamptz DEFAULT now());
      CREATE TABLE pos_items(id uuid DEFAULT gen_random_uuid(),name text,category text,active boolean);
      CREATE TABLE staff_permissions(id uuid DEFAULT gen_random_uuid(),user_id uuid REFERENCES profiles,permission_type text,game_id uuid REFERENCES games);
      CREATE OR REPLACE FUNCTION user_has_permission(uuid,text,uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
        SELECT EXISTS(SELECT 1 FROM public.staff_permissions WHERE user_id=$1 AND permission_type=$2 AND (game_id=$3 OR $2<>'game')) $$;`);
    for (const g of manifest.filter(g => g.name !== 'Busk for a Cause')) await db.query('INSERT INTO games(id,name,studio,price,awards_pinkredible) VALUES($1,$2,\'General\',$3,$4)', [g.id,g.name,g.price,g.group==='tier_2'||g.group==='tier_3']);
    const obsolete = randomUUID();
    await db.query("INSERT INTO games(id,name,studio,price,available) VALUES($1,'Hurdles','General',750,false)", [obsolete]);
    await db.exec("INSERT INTO pos_items(name,category,active) VALUES('Karaoke','custom_game',true)");
    for (const r of roster) { r.id=randomUUID(); await db.query('INSERT INTO profiles(id,email,role) VALUES($1,$2,\'staff\')',[r.id,r.email]); }
    const workTarun=randomUUID(); await db.query("INSERT INTO profiles(id,email,role) VALUES($1,'tarun@hashtag.dance','staff')",[workTarun]);
    await db.exec(functionSQL('supabase/migrations/20260906090000_pinkredibles.sql','spend_wallet_coins'));
    await db.exec(retries);
    await db.exec(activityMigration);
    const columns=(await db.query("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='games' AND column_name IN ('activity_group','pricing_mode') ORDER BY column_name")).rows;
    assert.deepEqual(columns,[{column_name:'activity_group',data_type:'text',is_nullable:'NO'},{column_name:'pricing_mode',data_type:'text',is_nullable:'NO'}]);
    const gameTypes=readFileSync('src/integrations/supabase/types.ts','utf8').split('      games: {')[1].split('      pos_items: {')[0];
    for(const field of ['activity_group','pricing_mode']) {
      assert.ok(gameTypes.includes(`${field}: string`));
      assert.equal(gameTypes.split(`${field}?: string`).length-1,2,'insert/update match schema defaults');
    }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='public' AND p.proname='spend_wallet_coins'")).rows[0].n,1,'no ambiguous integer overload remains');
    await db.exec(assignments);
    await db.exec(assignments);
    const games=(await db.query('SELECT * FROM games WHERE available ORDER BY name')).rows;
    assert.equal(games.length,15); assert.equal(new Set(games.map(g=>g.name)).size,15);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM staff_permissions')).rows[0].n,33);
    for (const g of games) {
      const expected=manifest.find(m=>m.name===g.name);
      assert.equal(g.activity_group,expected.group); assert.equal(Number(g.price),expected.price); assert.equal(g.pricing_mode,expected.mode);
      if (g.name!=='Busk for a Cause') assert.equal(g.id,expected.id,'preserves historic ID');
    }
    assert.equal((await db.query('SELECT active FROM pos_items')).rows[0].active,false);
    const login=async(id=admin,role='authenticated')=>{ await db.exec('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id]); await db.exec(`SET ROLE ${role}`); };
    const karaoke=games.find(g=>g.name==='Karaoke');
    const request=(game=karaoke,amount=150)=>({kind:'spend',wallet_id:wallet,coin_amount:amount,transaction_type:'games',game_id:game.id,item_name:'untrusted label',item_category:'games',reference:'DONATION via:phone-lookup'});
    const call=async(req,id=randomUUID())=>(await db.query('SELECT execute_wallet_operation($1,$2) AS r',[id,JSON.stringify(req)])).rows[0].r;
    const direct=async(amount,game=karaoke)=>db.query("SELECT * FROM spend_wallet_coins($1,$2::numeric,'games','untrusted','games',$3,'direct')",[wallet,amount,game.id]);
    await t.test('every named staff member only has the assigned groups; work Tarun denied',async()=>{
      for(const person of roster){
        await login(person.id);
        for(const game of games){
          const allowed=person.groups.includes(game.activity_group);
          if(!allowed) await assert.rejects(call(request(game,Number(game.price)||150)),/not assigned/);
          else if(game.pricing_mode==='free') assert.equal((await call(request(game))).status,'rejected');
          else {
            const r=await call(request(game,Number(game.price)));
            assert.equal(r.status,'succeeded',`${person.email} ${game.name}: ${r.message}`);
            await db.exec(`RESET ROLE; UPDATE wallets SET coin_balance=10000,balance=10000 WHERE id='${wallet}'`);
            await login(person.id);
          }
        }
      }
      await login(workTarun); await assert.rejects(call(request()),/not assigned/);
      await login('','anon'); await assert.rejects(call(request()),/permission denied/);
    });
    await t.test('original API input rejects fractions, zero, negatives, strings, null and under-minimum values',async()=>{
      await login();
      for(const amount of [null,'', '150',0,-1,149,149.99,150.5,2147483648]) assert.equal((await call(request(karaoke,amount))).status,'rejected',String(amount));
      for(const amount of ['149','149.99','150.5','NaN','Infinity','2147483648']) await assert.rejects(direct(amount),/whole number|at least/);
      assert.equal((await call(request(karaoke,150))).status,'succeeded');
      assert.equal((await call(request(karaoke,251))).status,'succeeded');
    });
    await t.test('retry recovers the original receipt after configuration changes, with one ledger entry and no INR',async()=>{
      await login(); const id=randomUUID(),req=request(karaoke,333),first=await call(req,id);
      assert.equal(first.status,'succeeded');
      await db.exec(`RESET ROLE; UPDATE games SET price=500,available=false WHERE id='${karaoke.id}'`); await login();
      assert.deepEqual(await call(req,id),first);
      assert.equal((await call(req)).status,'rejected');
      await db.exec('RESET ROLE');
      const tx=(await db.query('SELECT * FROM transactions WHERE id=$1',[first.transaction_id])).rows[0];
      assert.equal(tx.coin_amount,-333); assert.equal(tx.inr_amount,null); assert.equal(tx.game_id,karaoke.id); assert.equal(tx.item_name,'Karaoke'); assert.equal(tx.item_category,'donations'); assert.match(tx.reference,/via:phone-lookup/);
      const sale=(await db.query('SELECT * FROM game_sales WHERE transaction_id=$1',[first.transaction_id])).rows;
      assert.equal(sale.length,1); assert.equal(sale[0].coin_price,333);
      await db.exec(`UPDATE games SET price=150,available=true WHERE id='${karaoke.id}'`);
    });
    await t.test('blocked, insufficient, changed fixed prices, missing game IDs and free payments are rejected',async()=>{
      await login();
      assert.equal((await call(request(karaoke,100000))).status,'rejected');
      assert.equal((await call({...request(),game_id:null})).status,'rejected');
      assert.equal((await call(request(games.find(g=>g.name==='Hurdle'),1))).status,'rejected');
      for(const g of games.filter(g=>g.pricing_mode==='free')) await assert.rejects(direct('150',g),/Free activities/);
      await db.exec(`RESET ROLE; UPDATE wallets SET status='blocked' WHERE id='${wallet}'`); await login();
      assert.equal((await call(request())).status,'rejected');
      await db.exec(`RESET ROLE; UPDATE wallets SET status='active' WHERE id='${wallet}'`);
    });
    await t.test('simultaneous retry identities debit once; no award eligibility for free or donation modes',async()=>{
      await login(); const id=randomUUID(),req=request();
      const results=await Promise.all([call(req,id),call(req,id),call(req,id)]);
      assert.ok(results.every(r=>r.status==='succeeded')); assert.equal(new Set(results.map(r=>r.transaction_id)).size,1);
      await db.exec('RESET ROLE');
      await assert.rejects(db.query('UPDATE games SET awards_pinkredible=true WHERE id=$1',[karaoke.id]),/check constraint/);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM games WHERE awards_pinkredible AND pricing_mode='fixed'")).rows[0].n,6);
    });
    await t.test('assignment preflight rolls back on missing account and preserves unrelated permissions',async()=>{
      await db.exec('RESET ROLE');
      await db.query("INSERT INTO staff_permissions(user_id,permission_type) VALUES($1,'food')",[admin]);
      await db.exec(assignments);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM staff_permissions WHERE permission_type='food'")).rows[0].n,1);
      await db.query("UPDATE profiles SET role='admin' WHERE id=$1",[roster[0].id]);
      await assert.rejects(db.exec(assignments),/staff-only profile/); await db.exec('ROLLBACK');
      assert.equal((await db.query("SELECT count(*)::int AS n FROM staff_permissions WHERE permission_type='game'")).rows[0].n,33);
    });
  } finally { await db.close(); }
});
