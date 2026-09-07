import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { fixture, functionSQL, migration, admin, wallet, spend, topup } from './test-wallet-retries.mjs';

const voidMigration = readFileSync('supabase/migrations/20260907184809_pos_sale_void_controls.sql','utf8');
test('POS void SQL: role checks, immutable audit and retry safety',async(t)=>{
  const db = new PGlite();
  try {
    await db.exec(fixture);
    await db.exec(functionSQL('supabase/migrations/20260904000100_harden_wallet_coin_flows.sql','credit_wallet_coins'));
    await db.exec(functionSQL('supabase/migrations/20260906090000_pinkredibles.sql','spend_wallet_coins'));
    await db.exec(migration);
    await db.exec('CREATE TABLE game_round_players(transaction_id uuid)');
    await db.exec(voidMigration); await db.exec(voidMigration);
    const login=async(who=admin,role='authenticated')=>{
      await db.exec('RESET ROLE');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);
      await db.exec(`SET ROLE ${role}`);
    };
    const query=async(sql,args=[])=>{await db.exec('RESET ROLE'); const r=await db.query(sql,args); await login(); return r.rows;};
    const pay=async(request=spend)=>(await db.query('select execute_wallet_operation($1,$2) r',[randomUUID(),JSON.stringify(request)])).rows[0].r;
    const request=sale=>({kind:'void',wallet_id:wallet,sale_transaction_id:sale.transaction_id,void_reason:'Wrong item selected'});
    const reverse=async(req,id=randomUUID())=>(await db.query('select void_pos_sale($1,$2) r',[id,JSON.stringify(req)])).rows[0].r;
    const balance=async()=>(await query('select coin_balance from wallets where id=$1',[wallet]))[0].coin_balance;
    await login();
    await t.test('preserves sale and returns one historical refund across operation IDs',async()=>{
      const before=await balance(), sale=await pay(), req=request(sale), id=randomUUID();
      const original=await query('select * from transactions where id=$1',[sale.transaction_id]);
      const refund=await reverse(req,id);
      assert.equal(refund.status,'succeeded');assert.equal(refund.credited_coin_amount,750);
      assert.equal(await balance(),before);
      assert.deepEqual(await query('select * from transactions where id=$1',[sale.transaction_id]),original);
      await pay();
      assert.deepEqual(await reverse(req,id),refund);
      assert.deepEqual(await reverse(req),refund);
      assert.equal(await balance(),before-750);
      const rows=await query('select * from transactions where reverses_transaction_id=$1',[sale.transaction_id]);
      assert.equal(rows.length,1);assert.equal(rows[0].type,'refund');assert.equal(rows[0].inr_amount,null);
      assert.equal(rows[0].staff_user_id,admin);assert.equal(rows[0].void_reason,req.void_reason);
      await assert.rejects(reverse({...req,void_reason:'Different reason'},id),/different operator or request/);
      const other=randomUUID();await query("insert into profiles(id,role) values($1,'admin')",[other]);
      await login(other);await assert.rejects(reverse(req,id),/different operator/);await login();
      await query("update profiles set role='staff' where id=$1",[admin]);
      await assert.rejects(reverse(req,id),/Only admins/);
      await query("update profiles set role='admin' where id=$1",[admin]);
    });
    await t.test('staff, managers, anonymous users and missing identity cannot void',async()=>{
      const sale=await pay();
      for(const role of ['staff','studio_manager']){
        const who=randomUUID();await query('insert into profiles(id,role) values($1,$2)',[who,role]);
        await login(who);await assert.rejects(reverse(request(sale)),/Only admins/);
      }
      await login('','anon');await assert.rejects(reverse(request(sale)),/permission denied/);
      await login('');await assert.rejects(reverse(request(sale)),/Only admins/);await login();
    });
    await t.test('rejects round entries, non-sales, wrong wallets and invalid reasons',async()=>{
      const round=await pay({...spend,reference:'ROUND_test'});
      assert.match((await reverse(request(round))).message,/Round entries/);
      const linked=await pay();await query('insert into game_round_players values($1)',[linked.transaction_id]);
      assert.match((await reverse(request(linked))).message,/Round entries/);
      const credit=await pay(topup('void-test-topup'));
      assert.equal((await reverse(request(credit))).status,'rejected');
      const sale=await pay();
      for(const req of [{...request(sale),wallet_id:randomUUID()},{...request(sale),void_reason:'x'},
        {...request(sale),void_reason:'x'.repeat(501)}]) assert.equal((await reverse(req)).status,'rejected');
    });
    await t.test('inactive original band and failed refund insert never change balance',async()=>{
      const sale=await pay(),before=await balance();
      await query("update wallets set status='blocked' where id=$1",[wallet]);
      assert.equal((await reverse(request(sale))).status,'rejected');assert.equal(await balance(),before);
      await query("update wallets set status='active' where id=$1",[wallet]);
      await query(`CREATE FUNCTION fail_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Refund insert rejected'; END $$;`);
      await query('CREATE TRIGGER test_refund_failure BEFORE INSERT ON transactions FOR EACH ROW EXECUTE FUNCTION fail_refund()');
      const id=randomUUID(),failed=await reverse(request(sale),id);
      assert.equal(failed.status,'rejected');assert.equal(await balance(),before);
      assert.equal((await query('select id from transactions where reverses_transaction_id=$1',[sale.transaction_id])).length,0);
      await query('DROP TRIGGER test_refund_failure ON transactions');
      assert.deepEqual(await reverse(request(sale),id),failed);
      assert.equal((await reverse(request(sale))).status,'succeeded');assert.equal(await balance(),before+750);
    });
  } finally {await db.close();}
});
