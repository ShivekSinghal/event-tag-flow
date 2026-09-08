import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { install, admin, manager, other, staff, studio, token, code, bad, request } from './cash-fixture.mjs';

const runtime=process.env.PINKD_EMBEDDED_POSTGRES_ROOT;
test('cash integrity using independent PostgreSQL connections', {skip:!runtime,timeout:90000},async t=>{
  const {default: EmbeddedPostgres}=await import(pathToFileURL(path.join(runtime,'node_modules/embedded-postgres/dist/index.js')));
  const dir=await mkdtemp(path.join(tmpdir(),'pinkd-cash-pg-'));
  const server=new EmbeddedPostgres({databaseDir:path.join(dir,'db'),user:'postgres',password:randomUUID(),port:55443,persistent:false,postgresFlags:['-h','127.0.0.1','-k',dir],onLog:()=>{},onError:()=>{}});
  const clients=[];
  try {
    await server.initialise();await server.start();
    for(let i=0;i<4;i++){const c=server.getPgClient();await c.connect();clients.push(c);}
    const [owner,a,b,c]=clients; await install(owner);
    const create=(client=a,id=randomUUID(),req=request())=>client.query('SELECT create_cash_event_order_checkout($1,$2,$3) r',[id,token,JSON.stringify(req)]).then(v=>v.rows[0].r);
    const action=(client,oid,kind,hash=null,id=randomUUID(),actor=manager)=>client.query('SELECT cash_desk_action($1,$2,$3,$4,$5) r',[actor,id,oid,kind,hash]).then(v=>v.rows[0].r);
    for(const client of [a,b,c]) await client.query('SET ROLE service_role');
    // Public creation is intentional; service roles do not get implicit PUBLIC execute in production.
    await owner.query('GRANT EXECUTE ON FUNCTION create_cash_event_order_checkout(uuid,text,jsonb) TO service_role');
    await t.test('same checkout UUID returns one reservation; changed cart is rejected',async()=>{
      const id=randomUUID();await a.query('BEGIN');const first=await create(a,id);
      let settled=false;const second=create(b,id).then(v=>{settled=true;return v;});
      await new Promise(r=>setTimeout(r,100));assert.equal(settled,false);await a.query('COMMIT');assert.deepEqual(await second,first);
      assert.ok(Date.parse(first.hold_expires_at)-Date.now()<=300000);
      await assert.rejects(create(a,id,{...request(),customer_name:'Changed'}),/another request/);
    });
    await t.test('anonymous and staff cannot access private ledger or mutations; managers are studio scoped',async()=>{
      const order=await create();
      await assert.rejects(action(a,order.order_id,'request_code',code,randomUUID(),other),/access denied/);
      await assert.rejects(action(a,order.order_id,'cancel',null,randomUUID(),staff),/access denied/);
      await c.query('RESET ROLE');await c.query('SET ROLE anon');
      await assert.rejects(c.query('SELECT * FROM cash_booking_confirmations'),/permission denied/);
      await assert.rejects(action(c,order.order_id,'confirm',code),/permission denied/);
      await c.query('RESET ROLE');await c.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[other]);await c.query('SET ROLE authenticated');
      assert.deepEqual((await c.query('SELECT list_cash_desk_orders() r')).rows[0].r,[]);
      await assert.rejects(c.query('INSERT INTO cash_manager_studios VALUES($1,$2)',[other,studio]),/row-level security/);
      await c.query('RESET ROLE');await c.query('SET ROLE service_role');
    });
    await t.test('first send extends once; three resends; old code invalid; attempts serialize',async()=>{
      const order=await create();const first=await action(a,order.order_id,'request_code',code);
      assert.ok(Date.parse(first.hold_expires_at)-Date.now()>590000);
      const resend=await action(a,order.order_id,'request_code',bad);assert.equal(resend.hold_expires_at,first.hold_expires_at);
      const attempts=await Promise.all([a,b,c].map(conn=>action(conn,order.order_id,'confirm',code)));
      assert.deepEqual(attempts.map(v=>v.attempts_left).sort(),[0,1,2]);
      assert.equal((await action(a,order.order_id,'confirm',bad)).status,'rejected');
      await action(a,order.order_id,'request_code',code);await action(a,order.order_id,'request_code',code);
      assert.equal((await action(a,order.order_id,'request_code',code)).status,'rejected');
    });
    await t.test('confirmation/cancellation race cannot produce cancelled then paid; replay returns same receipt',async()=>{
      const order=await create();await action(a,order.order_id,'request_code',code);
      const id=randomUUID();await a.query('BEGIN');const paid=await action(a,order.order_id,'confirm',code,id);
      const cancelled=action(b,order.order_id,'cancel');await a.query('COMMIT');assert.equal(paid.confirmed,true);assert.equal((await cancelled).confirmed,true);
      assert.deepEqual(await action(a,order.order_id,'confirm',code,id),paid);
      assert.equal((await owner.query("SELECT count(*)::int n FROM cash_notifications WHERE order_id=$1 AND kind IN ('confirmation','alert')",[order.order_id])).rows[0].n,2);
      const another=await create();await action(a,another.order_id,'request_code',code);
      await a.query('BEGIN');await action(a,another.order_id,'cancel');const waiting=action(b,another.order_id,'confirm',code);await a.query('COMMIT');assert.equal((await waiting).status,'rejected');
      await assert.rejects(owner.query("UPDATE event_orders SET payment_status='paid' WHERE id=$1",[another.order_id]),/Cash Desk/);
    });
    await t.test('notification leases serialize and preserve their first attempt time',async()=>{
      const order=await create();await action(a,order.order_id,'request_code',code);
      const job=(await owner.query('SELECT id FROM cash_notifications WHERE order_id=$1',[order.order_id])).rows[0].id;
      const claim=(client)=>client.query('SELECT claim_cash_notification($1,$2) r',[job,randomUUID()]).then(v=>v.rows[0].r);
      await a.query('BEGIN');const first=await claim(a);const competing=claim(b);await a.query('COMMIT');
      assert.equal(await competing,null);
      await owner.query("UPDATE cash_notifications SET claimed_at=now()-interval '3 minutes' WHERE id=$1",[job]);
      const recovered=await claim(b);assert.equal(recovered.first_attempt_at,first.first_attempt_at);
      await owner.query("UPDATE cash_notifications SET status='sent' WHERE id=$1",[job]);
      assert.equal(await claim(c),null);
    });
    await t.test('last intensive seat: online checkout and cash share the same lock',async()=>{
      await owner.query("UPDATE event_sessions SET seat_cap=1 WHERE slot_label='s1'");
      const req=request([{item_type:'event_package',package_key:'one-intensive',quantity:1,selected_time_slots:['s1']}]);
      await a.query('BEGIN');await create(a,randomUUID(),req);
      await b.query('RESET ROLE');await b.query('SET ROLE anon');
      const online=b.query('SELECT * FROM create_event_order_checkout($1,$2,$3,$4,$5,$6,$7)',[req.customer_name,req.customer_phone,req.customer_email,JSON.stringify(req.cart_items),token,req.customer_studio,'{}']).then(()=>({ok:true}),e=>({error:e.message}));
      await a.query('COMMIT');assert.match((await online).error,/Sold out/);
      await b.query('RESET ROLE');await b.query('SET ROLE service_role');
    });
    await t.test('revival checks aggregate multi-line seats, live holds, cancellation and code invalidation',async()=>{
      const req=request([{package_key:'one-intensive',quantity:1,selected_time_slots:['s2']},{package_key:'one-intensive',quantity:1,selected_time_slots:['s2']}]);
      const order=await create(a,randomUUID(),req);await action(a,order.order_id,'request_code',code);
      await owner.query("SELECT set_config('pinkd.cash_action',$1,false)",[order.order_id]);
      await owner.query("UPDATE event_orders SET checkout_token_expires_at=now()-interval '1 minute' WHERE id=$1",[order.order_id]);
      await owner.query("UPDATE event_sessions SET seat_cap=1 WHERE slot_label='s2'");
      await assert.rejects(action(a,order.order_id,'revive'),/Session unavailable/);
      await owner.query("UPDATE event_sessions SET seat_cap=3 WHERE slot_label='s2'");
      assert.equal((await action(a,order.order_id,'revive')).revived,true);
      assert.equal((await action(a,order.order_id,'confirm',code)).status,'rejected');
      const before=(await owner.query('SELECT checkout_token_expires_at FROM event_orders WHERE id=$1',[order.order_id])).rows[0].checkout_token_expires_at;
      assert.equal((await action(a,order.order_id,'revive')).revived,false);
      assert.deepEqual((await owner.query('SELECT checkout_token_expires_at FROM event_orders WHERE id=$1',[order.order_id])).rows[0].checkout_token_expires_at,before);
      await action(a,order.order_id,'cancel');assert.equal((await action(a,order.order_id,'revive')).status,'rejected');
    });
    await t.test('coin carts, moved phase prices, inactive packages and old bookings are refused',async()=>{
      await assert.rejects(create(a,randomUUID(),request([{item_type:'coin_package',coin_package_id:randomUUID(),quantity:1}])),/tickets and intensives only/);
      const order=await create();await owner.query("SELECT set_config('pinkd.cash_action',$1,false)",[order.order_id]);await owner.query("UPDATE event_orders SET checkout_token_expires_at=now()-interval '1 minute' WHERE id=$1",[order.order_id]);
      await owner.query('UPDATE event_pricing_phases SET party_price_inr=2499 WHERE phase_number=1');
      await assert.rejects(action(a,order.order_id,'revive'),/price changed/);
      await owner.query("UPDATE event_orders SET created_at=now()-interval '46 minutes' WHERE id=$1",[order.order_id]);
      assert.equal((await action(a,order.order_id,'revive')).status,'rejected');
      await owner.query("UPDATE event_packages SET active=false WHERE id='party-entry'");
      await assert.rejects(create(),/unavailable/);
    });
    await t.test('permission revocation blocks even a successful retry',async()=>{
      const req=request([{package_key:'one-intensive',quantity:1,selected_time_slots:['s3']}]);
      const order=await create(a,randomUUID(),req), id=randomUUID();await action(a,order.order_id,'request_code',code,id);
      await owner.query('DELETE FROM cash_manager_studios WHERE user_id=$1',[manager]);
      await assert.rejects(action(a,order.order_id,'request_code',code,id),/access denied/);
      assert.equal((await action(a,order.order_id,'cancel',null,randomUUID(),admin)).cancelled,true);
    });
  } finally { for(const client of clients) await client.end();await server.stop(); }
});
