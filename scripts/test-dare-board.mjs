import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const source = readFileSync('src/lib/dareBoard.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('require', 'exports', compiled)(require, exports);
const { DARE_MILESTONES, dareCheckpoint, crossedDares, dareProgressSchema } = exports;

test('eleven exact milestones, boundary progress, refunds, and multi-unlocks', () => {
  assert.deepEqual(DARE_MILESTONES, [10000,25000,50000,75000,100000,150000,200000,300000,400000,500000,1000000]);
  assert.equal(dareCheckpoint(0).remaining, 10000);
  assert.equal(dareCheckpoint(9999).completed, 0);
  assert.equal(dareCheckpoint(10000).next, 25000);
  assert.equal(dareCheckpoint(10000).percent, 0);
  assert.equal(dareCheckpoint(17500).percent, 50);
  assert.equal(dareCheckpoint(1000001).percent, 100);
  assert.equal(dareCheckpoint(1000001).next, undefined);
  assert.deepEqual(crossedDares(9000, 76000), [10000,25000,50000,75000]);
  assert.deepEqual(crossedDares(76000, 9000), []);
  assert.equal(dareCheckpoint(9000).completed, 0);
});

test('reject malformed or inconsistent financial responses instead of showing false progress', () => {
  const valid = { total_coins: 100, tier_1_coins: 50, food_coins: 25, bar_coins: 25, counted_sales: 1, as_of: new Date().toISOString(), milestone_pickers: [], recent_transactions: [], latest_transactions: [], log_has_more: false };
  assert.equal(dareProgressSchema.safeParse(valid).success, true);
  assert.equal(dareProgressSchema.parse(valid).performance_coins, 0, 'older backend remains compatible during rollout');
  assert.equal(dareProgressSchema.safeParse({...valid, total_coins:3750, performance_coins:3650}).success, true);
  for (const changes of [{total_coins:101}, {food_coins:-1}, {bar_coins:'25'}, {performance_coins:-1}, {performance_coins:1}, {as_of:'bad'}, {total_coins:Infinity}]) {
    assert.equal(dareProgressSchema.safeParse({...valid, ...changes}).success, false);
  }
  assert.equal(dareProgressSchema.safeParse({...valid, total_coins:10000,tier_1_coins:9950}).success,false,'reached checkpoints require a picker');
});

test('real Postgres aggregate: category snapshots, no topups, voids, >1000 rows and role checks', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY, role text);
      CREATE TABLE games(id uuid PRIMARY KEY, activity_group text, name text);
      CREATE TABLE wallets(id uuid PRIMARY KEY, attendee_name text, studio text);
      CREATE TABLE transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, item_category text, coin_amount integer, game_id uuid, reverses_transaction_id uuid, created_at timestamptz NOT NULL DEFAULT now(), wallet_id uuid, item_name text);
      INSERT INTO profiles VALUES ('00000000-0000-4000-8000-000000000001','admin'),('00000000-0000-4000-8000-000000000002','staff'),('00000000-0000-4000-8000-000000000003','studio_manager');
      INSERT INTO games VALUES ('00000000-0000-4000-8000-000000000011','tier_1','Spin the Wheel');
    `);
    const migration = readFileSync('supabase/migrations/20260911151309_dare_board_progress.sql','utf8');
    await db.exec(migration); await db.exec(migration);
    const performances = readFileSync('supabase/migrations/20260911203638_dare_board_karaoke_busk.sql','utf8');
    await db.exec(performances); await db.exec(performances);
    const login = async (id, role='authenticated') => {
      await db.exec('RESET ROLE');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      await db.exec(`SET ROLE ${role}`);
    };
    const get = async () => (await db.query('select get_dare_board_progress() as r')).rows[0].r;
    await login('00000000-0000-4000-8000-000000000001');
    assert.equal((await get()).total_coins, 0);
    await db.exec('RESET ROLE');
    await db.exec(`
      INSERT INTO transactions(type,item_category,coin_amount) VALUES
      ('games','tier_1',-450), ('food','food',-500), ('drinks','drinks',-750),
      ('games','tier_2',-750), ('games','tier_3',-1000), ('games','donations',-150),
      ('games','free',0), ('coin_purchase',null,30000), ('load',null,4000), ('refund','tier_1',450);
      INSERT INTO transactions(type,item_category,coin_amount,game_id) VALUES
      ('games',null,-450,'00000000-0000-4000-8000-000000000011'),
      ('games','games',-450,'00000000-0000-4000-8000-000000000011'),
      ('games','tier_2',-750,'00000000-0000-4000-8000-000000000011');
      INSERT INTO transactions(type,item_category,coin_amount) SELECT 'food','food',-1 FROM generate_series(1,1500);
    `);
    await login('00000000-0000-4000-8000-000000000001');
    const before = await get();
    assert.equal(before.total_coins, 4100);
    assert.equal(before.tier_1_coins, 1350);
    assert.equal(before.food_coins, 2000);
    assert.equal(before.bar_coins, 750);
    assert.equal(before.counted_sales, 1505);
    assert.deepEqual(Object.keys(before).sort(), ['as_of','bar_coins','counted_sales','food_coins','latest_transactions','log_has_more','milestone_pickers','performance_coins','recent_transactions','tier_1_coins','total_coins']);
    assert.equal(before.recent_transactions.length,20);
    assert.equal(before.log_has_more,true);
    assert.equal(before.latest_transactions.length,3);
    assert.deepEqual(Object.keys(before.recent_transactions[0]).sort(),['coins','created_at','first_name','item_name','source','studio','transaction_id','voided']);
    const last=before.recent_transactions.at(-1);
    const older=(await db.query('select get_dare_board_progress($1,$2) r',[last.created_at,last.transaction_id])).rows[0].r;
    assert.equal(older.total_coins,before.total_coins);
    assert.equal(older.recent_transactions.length,20);
    assert.equal(older.recent_transactions.some(r=>before.recent_transactions.some(p=>p.transaction_id===r.transaction_id)),false);
    await assert.rejects(db.query('select get_dare_board_progress($1)',[last.created_at]),/Both contribution cursor/);
    await db.exec('RESET ROLE');
    await db.exec("INSERT INTO transactions(type,coin_amount,reverses_transaction_id) SELECT 'refund',750,id FROM transactions WHERE type='drinks'");
    await login('00000000-0000-4000-8000-000000000001');
    assert.equal((await get()).total_coins, 3350);
    assert.equal((await get()).bar_coins, 0);
    await db.exec('RESET ROLE');
    await db.exec(`
      TRUNCATE transactions;
      INSERT INTO wallets VALUES ('00000000-0000-4000-8000-000000000101','  Mira   Kapoor ','RG'),
        ('00000000-0000-4000-8000-000000000102','Asha Singh','NDA'),
        ('00000000-0000-4000-8000-000000000103','Dev Jain','GGN');
      INSERT INTO transactions(id,type,item_category,coin_amount,created_at,wallet_id,item_name) VALUES
      ('00000000-0000-4000-8000-000000000201','food','food',-9000,'2026-09-11 16:00:00Z',null,'Food'),
      ('00000000-0000-4000-8000-000000000202','games','tier_1',-1000,'2026-09-11 16:01:00Z','00000000-0000-4000-8000-000000000101','Spin the Wheel'),
      ('00000000-0000-4000-8000-000000000203','drinks','drinks',-15000,'2026-09-11 16:02:00Z','00000000-0000-4000-8000-000000000102','Bar'),
      ('00000000-0000-4000-8000-000000000204','food','food',-1000,'2026-09-11 16:03:00Z','00000000-0000-4000-8000-000000000103','Food');
    `);
    await login('00000000-0000-4000-8000-000000000001');
    const reached=await get();
    assert.equal(reached.total_coins,26000);
    assert.deepEqual(reached.milestone_pickers.map(p=>[p.milestone,p.first_name]),[[10000,'Mira'],[25000,'Asha']]);
    assert.equal(reached.latest_transactions[0].first_name,'Dev','latest payer is not the checkpoint picker');
    assert.equal(reached.milestone_pickers[0].studio,'RG');
    assert.ok(!JSON.stringify(reached).includes('Kapoor'));
    assert.equal(dareProgressSchema.safeParse(reached).success,true);
    assert.deepEqual((await get()).milestone_pickers,reached.milestone_pickers,'refresh is deterministic');
    await db.exec('RESET ROLE');
    await db.exec("INSERT INTO transactions(type,coin_amount,reverses_transaction_id) VALUES ('refund',1000,'00000000-0000-4000-8000-000000000202')");
    await login('00000000-0000-4000-8000-000000000001');
    const corrected=await get();
    assert.deepEqual(corrected.milestone_pickers.map(p=>[p.milestone,p.first_name]),[[10000,'Asha'],[25000,'Dev']]);
    assert.equal(corrected.recent_transactions.find(t=>t.first_name==='Mira').voided,true);
    await db.exec('RESET ROLE');
    await db.exec(`TRUNCATE transactions;
      INSERT INTO transactions(id,type,coin_amount,created_at,wallet_id) VALUES
      ('00000000-0000-4000-8000-000000000302','food',-17000,'2026-09-11 16:00:00Z','00000000-0000-4000-8000-000000000101'),
      ('00000000-0000-4000-8000-000000000301','food',-9000,'2026-09-11 16:00:00Z',null);
    `);
    await login('00000000-0000-4000-8000-000000000001');
    assert.deepEqual((await get()).milestone_pickers.map(p=>[p.milestone,p.first_name]),[[10000,'Mira'],[25000,'Mira']],'same timestamp ties use ID; one sale may cross multiple checkpoints');
    for (const id of ['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','']) {
      await login(id); await assert.rejects(get(), /Only admins/);
    }
    await login('', 'anon'); await assert.rejects(get(), /permission denied/);
  } finally { await db.close(); }
});

test('Karaoke and Busk include existing/future payments, name changes, correct pickers and voids only once', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE profiles(id uuid PRIMARY KEY, role text);
      CREATE TABLE games(id uuid PRIMARY KEY, activity_group text, name text, pricing_mode text, price integer, available boolean DEFAULT true);
      CREATE TABLE wallets(id uuid PRIMARY KEY, attendee_name text, studio text);
      CREATE TABLE transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, item_category text, coin_amount integer, game_id uuid, reverses_transaction_id uuid, created_at timestamptz NOT NULL DEFAULT now(), wallet_id uuid, item_name text);
      INSERT INTO profiles VALUES ('00000000-0000-4000-8000-000000000001','admin');
      INSERT INTO games(id,activity_group,name,pricing_mode,price) VALUES
        ('00000000-0000-4000-8000-000000000011','donations','Karaoke','donation',150),
        ('00000000-0000-4000-8000-000000000012','donations','Busk for a Cause','donation',150),
        ('00000000-0000-4000-8000-000000000013','donations','Other donation','donation',150);
      INSERT INTO wallets VALUES ('00000000-0000-4000-8000-000000000101','Mira Kapoor','RG');
      INSERT INTO transactions(id,type,item_category,coin_amount,game_id,item_name,created_at) VALUES
        ('00000000-0000-4000-8000-000000000201','games','donations',-3650,'00000000-0000-4000-8000-000000000011','Karaoke','2026-09-11T15:00:00Z'),
        ('00000000-0000-4000-8000-000000000202','games','donations',-99999,'00000000-0000-4000-8000-000000000013','Other donation','2026-09-11T15:01:00Z');
    `);
    const migration = readFileSync('supabase/migrations/20260911203638_dare_board_karaoke_busk.sql','utf8');
    await db.exec(migration); await db.exec(migration);
    await db.exec("SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false)");
    const get = async () => {
      await db.exec('SET ROLE authenticated');
      try { return (await db.query('SELECT get_dare_board_progress() r')).rows[0].r; }
      finally { await db.exec('RESET ROLE'); }
    };
    const historic = await get();
    assert.equal(historic.total_coins,3650);
    assert.equal(historic.performance_coins,3650);
    assert.equal(historic.tier_1_coins,0);
    assert.equal(historic.counted_sales,1);
    assert.equal(historic.recent_transactions[0].source,'performances');
    assert.equal(dareProgressSchema.safeParse(historic).success,true);
    const games=(await db.query('SELECT name,activity_group,pricing_mode,price,contributes_to_dare_board FROM games ORDER BY id')).rows;
    assert.deepEqual(games.map(g=>g.contributes_to_dare_board),[true,true,false]);
    assert.ok(games.every(g=>g.activity_group==='donations' && g.pricing_mode==='donation' && g.price===150));
    await db.exec(`
      UPDATE games SET name='Busk live', available=false WHERE name='Busk for a Cause';
      INSERT INTO transactions(id,type,item_category,coin_amount,game_id,wallet_id,item_name,created_at) VALUES
        ('00000000-0000-4000-8000-000000000203','games','donations',-6350,'00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000101','Busk live','2026-09-11T15:02:00Z'),
        ('00000000-0000-4000-8000-000000000204','games','tier_1',-150,'00000000-0000-4000-8000-000000000011',null,'Karaoke','2026-09-11T15:03:00Z');
      INSERT INTO transactions(type,coin_amount,game_id) VALUES
        ('coin_purchase',20000,'00000000-0000-4000-8000-000000000011'),
        ('games',0,'00000000-0000-4000-8000-000000000012');
    `);
    const future = await get();
    assert.equal(future.total_coins,10150);
    assert.equal(future.performance_coins,10150);
    assert.equal(future.tier_1_coins,0,'an opted-in game with a Tier 1 snapshot must not count twice');
    assert.equal(future.counted_sales,3);
    assert.deepEqual(future.milestone_pickers.map(p=>[p.milestone,p.first_name,p.item_name,p.source]),[[10000,'Mira','Busk live','performances']]);
    assert.equal(future.latest_transactions[0].item_name,'Karaoke','latest payer is not the milestone picker');
    assert.equal(dareProgressSchema.safeParse(future).success,true);
    assert.deepEqual((await get()).milestone_pickers,future.milestone_pickers);
    await db.exec("INSERT INTO transactions(type,coin_amount,reverses_transaction_id) VALUES ('refund',6350,'00000000-0000-4000-8000-000000000203')");
    const refunded=await get();
    assert.equal(refunded.total_coins,3800);
    assert.equal(refunded.counted_sales,2);
    assert.deepEqual(refunded.milestone_pickers,[]);
    assert.equal(refunded.recent_transactions.find(r=>r.item_name==='Busk live').voided,true);
    assert.equal(dareProgressSchema.safeParse(refunded).success,true);
  } finally { await db.close(); }
});
