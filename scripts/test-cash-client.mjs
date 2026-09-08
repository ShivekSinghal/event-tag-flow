import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import {checkCashBackend} from './check-cash-backend.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function harness() {
  const entries=new Map(),calls=[],queue=[];let latest,renderer,fail=false;
  const window=new EventTarget();window.setInterval=()=>0;window.clearInterval=()=>{};
  const receipt={order_id:webcrypto.randomUUID(),total_amount_inr:2000,hold_expires_at:new Date(Date.now()+300000).toISOString()};
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/hooks/useCashCheckout.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:name=>name==='react'?React:{supabase:{rpc:(name,args)=>{calls.push({name,args});return{abortSignal:()=>name==='cash_checkout_status'?Promise.resolve({data:receipt,error:null}):queue.shift().promise};}}},
    window,Event,AbortSignal,TextEncoder,crypto:webcrypto,console,sessionStorage:{getItem:k=>entries.get(k)||null,setItem:(k,v)=>{if(fail)throw Error('Storage failed');entries.set(k,v);},removeItem:k=>entries.delete(k)},
  });
  function Probe(){latest=exports.useCashCheckout();return null;}
  return {entries,calls,queue,receipt,get current(){return latest;},fail:()=>fail=true,mount:()=>act(async()=>{renderer=TestRenderer.create(React.createElement(Probe));}),unmount:()=>act(async()=>renderer.unmount())};
}
test('cash checkout persists its identity, freezes retries and recovers after refresh',async()=>{
  const h=harness();await h.mount();const response=deferred();h.queue.push(response);let promise;
  await act(async()=>{promise=h.current.submit({cash_studio:'Test',cart_items:[{package_key:'party-entry',quantity:1}]});await new Promise(r=>setTimeout(r,20));});
  assert.equal(h.calls.length,1);assert.equal(h.entries.size,1);
  await act(async()=>{await h.current.submit({changed:true});});assert.equal(h.calls.length,1);
  await act(async()=>{response.resolve({data:null,error:{message:'Lost connection'}});await promise;});assert.equal(h.current.pending,true);
  const first=JSON.stringify(h.calls[0].args);await h.unmount();await h.mount();assert.equal(h.current.pending,true);
  const retry=deferred();h.queue.push(retry);await act(async()=>{promise=h.current.submit();});
  assert.equal(JSON.stringify(h.calls[1].args),first);
  await act(async()=>{retry.resolve({data:h.receipt,error:null});await promise;});assert.equal(h.current.pending,false);assert.equal(h.current.receipt.order_id,h.receipt.order_id);
  assert.equal(JSON.parse([...h.entries.values()][0]).request,undefined,'contact details are removed from recovery storage once reserved');
  await h.unmount();
});
test('cash storage failure sends no order and no gateway',async()=>{
  const h=harness();await h.mount();h.fail();await act(async()=>{await h.current.submit({cart_items:[]});});assert.equal(h.calls.length,0);await h.unmount();
});
test('cash production gate requires both schema and configured Edge Function',async()=>{
  await checkCashBackend({VERCEL_ENV:'preview'},()=>{throw Error('Must not probe production');});
  await checkCashBackend({VERCEL_ENV:'production'},async url=>({status:200,json:async()=>url.includes('/rpc/')?1:{ready:true,cash_version:1}}));
  await assert.rejects(checkCashBackend({VERCEL_ENV:'production'},async()=>({status:404,json:async()=>({})})),/readiness/);
  await assert.rejects(checkCashBackend({VERCEL_ENV:'production'},async url=>({status:200,json:async()=>url.includes('/rpc/')?1:{ready:false,cash_version:1}})),/not ready/);
});
