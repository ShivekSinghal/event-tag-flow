import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_donation_collection_progress.sql')),'utf8');
test('collection snapshot accounting, historical prices, retries, access and scale',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE FUNCTION public.get_current_user_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role',true) $$;
      CREATE TABLE event_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),payment_status text,target_wallet_id uuid);
      CREATE TABLE event_order_items(order_id uuid,package_category text,line_total_inr numeric,quantity int);
      CREATE TABLE wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tag_id text);
      CREATE TABLE transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_id uuid,type text,reference text,inr_amount numeric,amount numeric);
      GRANT USAGE ON SCHEMA auth,public TO anon,authenticated;
      GRANT SELECT ON event_orders,event_order_items,wallets,transactions TO authenticated;
      ALTER TABLE event_orders ENABLE ROW LEVEL SECURITY;
      CREATE POLICY admin ON event_orders TO authenticated USING(public.get_current_user_role()='admin');
      SELECT set_config('test.uid','00000000-0000-4000-8000-000000000001',false);
      SELECT set_config('test.role','admin',false);
    `);
    await db.exec(migration); await db.exec(migration);
    const report=async(role='authenticated')=>{
      await db.exec('SET ROLE '+role);
      try {return (await db.query('SELECT get_donation_collection_progress() as data')).rows[0].data;}
      finally {await db.exec('RESET ROLE');}
    };
    assert.equal((await report()).total_inr,0);
    assert.equal((await report()).goal_inr,1000000);
    let paid;
    for(const status of ['paid','completed','pending','manual_payment','refunded','failed','cancelled']) {
      const id=(await db.query('INSERT INTO event_orders(payment_status) VALUES($1) RETURNING id',[status])).rows[0].id;
      if(status==='paid') paid=id;
      await db.query("INSERT INTO event_order_items VALUES($1,'coins',3000,3),($1,'party',6000,3)",[id]);
    }
    await db.exec(`INSERT INTO transactions(type,inr_amount,amount,reference) VALUES
      ('coin_purchase',500,750,'cash'),('coin_purchase',0,4000,'coins:123'),
      ('load',0,2000,'prepaid:456'),('coin_purchase',3000,4000,'coins:123'),
      ('games',500,500,null),('food',200,200,null),('drinks',100,100,null),
      ('refund',500,500,null),('load',NULL,9999,'legacy'),('load',0,10000,null)`);
    let r=await report();
    assert.equal(r.total_inr,6500); assert.equal(r.collection_count,3); assert.equal(r.unpriced_topups,1);
    await db.query("UPDATE event_orders SET payment_status='paid' WHERE id=$1",[paid]);
    assert.equal((await report()).total_inr,6500);
    await db.query("UPDATE event_orders SET payment_status='refunded' WHERE id=$1",[paid]);
    assert.equal((await report()).total_inr,3500);
    const w=(await db.query("INSERT INTO wallets(tag_id) VALUES('TEST-BAND-A3F') RETURNING id")).rows[0].id;
    await db.query("INSERT INTO transactions(wallet_id,type,inr_amount) VALUES($1,'load',9999)",[w]);
    const testOrder=(await db.query("INSERT INTO event_orders(payment_status,target_wallet_id) VALUES('paid',$1) RETURNING id",[w])).rows[0].id;
    await db.query("INSERT INTO event_order_items VALUES($1,'coins',9999,1)",[testOrder]);
    assert.equal((await report()).total_inr,3500);
    await db.exec("INSERT INTO transactions(type,inr_amount) SELECT 'coin_purchase',1.25 FROM generate_series(1,1005)");
    assert.equal((await report()).total_inr,4756.25);
    await assert.rejects(report('anon'),/permission denied/);
    for(const role of ['staff','studio_manager','']) {
      await db.query("SELECT set_config('test.role',$1,false)",[role]); await assert.rejects(report(),/Admin access required/);
    }
    await db.exec("SELECT set_config('test.role','admin',false)");
    const p=(await db.query("SELECT prosecdef,provolatile FROM pg_proc WHERE oid='get_donation_collection_progress()'::regprocedure")).rows[0];
    assert.equal(p.prosecdef,false); assert.equal(p.provolatile,'s');
    await db.exec('REVOKE SELECT ON transactions FROM authenticated'); await assert.rejects(report(),/permission denied/);
  } finally {await db.close();}
});
