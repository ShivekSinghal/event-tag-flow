import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import {checkAwardBackend} from './check-award-backend.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function harness() {
  const entries=new Map(),calls=[],queue=[];let latest,renderer,user={id:randomUUID()};
  const window=new EventTarget(),exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync('src/hooks/use-award-operation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:name=>name==='react'?React:name.includes('AuthContext')?{useAuth:()=>({user})}:{supabase:{rpc:(name,args)=>{calls.push({name,args});return{abortSignal:()=>queue.shift().promise};}}},
    window,Event,AbortSignal,crypto:{randomUUID},console,sessionStorage:{getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)},
  });
  function Probe(){latest=exports.useAwardOperation();return null;}
  return {entries,calls,queue,get current(){return latest;},setUser:value=>user=value,mount:()=>act(async()=>{renderer=TestRenderer.create(React.createElement(Probe));}),unmount:()=>act(async()=>renderer.unmount())};
}
const request={wallet_id:randomUUID(),game_id:randomUUID(),entry_transaction_id:randomUUID()};
test('award retry freezes winner and entry across refresh and double clicks',async()=>{
  const h=harness();await h.mount();const response=deferred();h.queue.push(response);let promise;
  await act(async()=>{promise=h.current.submit(request);});assert.equal(h.calls.length,1);assert.equal(h.current.blocked,true);
  await act(async()=>{await h.current.submit(request);});assert.equal(h.calls.length,1);
  await act(async()=>{response.resolve({data:null,error:{message:'Lost response'}});await promise;});
  const first=JSON.stringify(h.calls[0].args);await h.unmount();await h.mount();assert.equal(h.current.blocked,true);
  await act(async()=>{await h.current.submit({...request,wallet_id:randomUUID()});});assert.equal(h.calls.length,1);
  const retry=deferred();h.queue.push(retry);await act(async()=>{promise=h.current.submit();});assert.equal(JSON.stringify(h.calls[1].args),first);
  await act(async()=>{retry.resolve({data:{status:'succeeded',award_id:randomUUID(),entry_transaction_id:request.entry_transaction_id,pinkredibles:1,code:'PINK-TEST01'},error:null});await promise;});
  assert.equal(h.current.pending,null);assert.equal(h.current.blocked,false);assert.equal(h.current.receipt.pinkredibles,1);
  await h.unmount();h.setUser({id:randomUUID()});await h.mount();assert.equal(h.current.receipt,null);await h.unmount();
});
test('award result after navigation reaches the newly mounted screen',async()=>{
  const h=harness();await h.mount();const response=deferred();h.queue.push(response);let promise;
  await act(async()=>{promise=h.current.submit(request);});await h.unmount();await h.mount();
  await act(async()=>{response.resolve({data:{status:'succeeded',award_id:randomUUID(),entry_transaction_id:request.entry_transaction_id},error:null});await promise;});
  assert.equal(h.current.blocked,false);assert.ok(h.current.receipt.award_id);await h.unmount();
});
test('direct award production gate rejects missing migration',async()=>{
  await checkAwardBackend({VERCEL_ENV:'preview'},()=>{throw Error('Must not probe');});
  await checkAwardBackend({VERCEL_ENV:'production'},async()=>({status:200,json:async()=>1}));
  await assert.rejects(checkAwardBackend({VERCEL_ENV:'production'},async()=>({status:404,json:async()=>null})),/missing/);
});
