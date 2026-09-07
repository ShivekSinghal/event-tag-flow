import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { fixture, functionSQL, migration, admin, wallet, spend, topup } from './test-wallet-retries.mjs';

const runtime = process.env.PINKD_EMBEDDED_POSTGRES_ROOT;

test('independent PostgreSQL sessions: atomic retries, receipt races and rollbacks', {skip: !runtime, timeout: 90000}, async () => {
  const {default: EmbeddedPostgres} = await import(pathToFileURL(path.join(runtime, 'node_modules/embedded-postgres/dist/index.js')));
  const directory = await mkdtemp(path.join(tmpdir(), 'pinkd-wallet-pg-'));
  const server = new EmbeddedPostgres({databaseDir:path.join(directory,'db'),user:'postgres',password:randomUUID(),
    port:process.env.PINKD_TEST_PG_PORT ? Number(process.env.PINKD_TEST_PG_PORT) : 55439,
    persistent:false,postgresFlags:['-h','127.0.0.1','-k',directory],onLog:()=>{},onError:()=>{}});
  const clients=[];
  try {
    await server.initialise();await server.start();
    for(let i=0;i<4;i++){const c=server.getPgClient();await c.connect();clients.push(c);}
    const [owner,a,b,c]=clients;
    await owner.query(fixture);
    await owner.query(functionSQL('supabase/migrations/20260904000100_harden_wallet_coin_flows.sql','credit_wallet_coins'));
    await owner.query(functionSQL('supabase/migrations/20260906090000_pinkredibles.sql','spend_wallet_coins'));
    await owner.query(migration);
    await owner.query('CREATE TABLE game_round_players(transaction_id uuid)');
    await owner.query(readFileSync('supabase/migrations/20260907184809_pos_sale_void_controls.sql','utf8'));
    for(const client of [a,b,c]){
      await client.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
      await client.query('SET ROLE authenticated');
    }
    const call=(client,id,request)=>client.query('select public.execute_wallet_operation($1,$2) as result',[id,JSON.stringify(request)]).then(r=>r.rows[0].result);
    const balance=()=>owner.query('select coin_balance from wallets where id=$1',[wallet]).then(r=>r.rows[0].coin_balance);
    // Hold transaction A open after the debit so B/C must wait on its unique receipt.
    const id=randomUUID(),before=await balance();
    await a.query('BEGIN');const first=await call(a,id,spend);
    let settled=false;
    const duplicate=call(b,id,spend).then(r=>{settled=true;return r;});
    const third=call(c,id,spend);
    await new Promise(r=>setTimeout(r,150));assert.equal(settled,false);
    await a.query('COMMIT');
    assert.deepEqual(await duplicate,first);assert.deepEqual(await third,first);
    assert.equal(await balance(),before-750);

    // A rolled-back initial attempt leaves the operation available to the waiting retry.
    const rollback=randomUUID();await a.query('BEGIN');await call(a,rollback,spend);
    const waiting=call(b,rollback,spend);await a.query('ROLLBACK');
    assert.equal((await waiting).status,'succeeded');assert.equal(await balance(),before-1500);

    // Distinct operation IDs cannot reuse a receipt, even across concurrent requests.
    const results=await Promise.all([call(a,randomUUID(),topup('race-receipt')),call(b,randomUUID(),topup(' RACE-RECEIPT via:phone-lookup'))]);
    assert.deepEqual(results.map(r=>r.status).sort(),['rejected','succeeded']);
    assert.equal(await balance(),before-1500+2000);
    const rows=await owner.query('select count(*)::int as count from transactions');
    assert.equal(rows.rows[0].count,3);
    // Same and distinct void operation IDs serialize on the original sale.
    const voidId=randomUUID(),req={kind:'void',wallet_id:wallet,sale_transaction_id:first.transaction_id,void_reason:'Wrong item'};
    const reverse=(client,id)=>client.query('select void_pos_sale($1,$2) r',[id,JSON.stringify(req)]).then(r=>r.rows[0].r);
    await a.query('BEGIN');const refund=await reverse(a,voidId);
    assert.equal(refund.status,'succeeded');
    let refunded=false;const second=reverse(b,voidId).then(r=>{refunded=true;return r;});
    const distinct=reverse(c,randomUUID());
    await new Promise(r=>setTimeout(r,150));assert.equal(refunded,false);
    await a.query('COMMIT');assert.deepEqual(await second,refund);assert.deepEqual(await distinct,refund);
    assert.equal(await balance(),before-750+2000);
    assert.equal((await owner.query("select count(*)::int n from transactions where type='refund'")).rows[0].n,1);
  } finally {
    for(const client of clients) await client.end();
    await server.stop();
  }
});
