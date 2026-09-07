import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';

const compile = (file, require, globals={}) => {
  const exports={};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{exports,require,console,...globals});
  return exports;
};
const deferred=()=>{let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const request={kind:'spend',wallet_id:randomUUID(),coin_amount:750,transaction_type:'food',item_name:'Food',reference:'TEST'};

function harness() {
  const entries=new Map(), calls=[], network=[];
  let user={id:randomUUID()}, failWrite=false, latest;
  const storage={getItem:key=>entries.get(key)||null,setItem:(key,value)=>{if(failWrite)throw new Error('Storage disabled');entries.set(key,value);},removeItem:key=>entries.delete(key)};
  const window=new EventTarget();
  const domain=compile('src/lib/walletOperation.ts',()=>{});
  const hook=compile('src/hooks/use-wallet-operation.ts',(name)=>{
    if(name==='react')return React;
    if(name.includes('AuthContext'))return {useAuth:()=>({user})};
    if(name.includes('walletOperation'))return domain;
    if(name.includes('supabase/client'))return {supabase:{rpc:(name,args)=>{
      calls.push({name,args});const response=network.shift();return {abortSignal:()=>response.promise};
    }}};
    throw new Error(name);
  },{window,Event,sessionStorage:storage,crypto:{randomUUID},AbortSignal});
  function Probe(){latest=hook.useWalletOperation();return null;}
  let renderer;
  const mount=async()=>act(async()=>{renderer=TestRenderer.create(React.createElement(Probe));});
  const unmount=async()=>act(async()=>renderer.unmount());
  return {entries,calls,network,mount,unmount,get current(){return latest;},setUser:value=>user=value,failWrites:()=>failWrite=true};
}

test('actual retry hook persists identity through lost response, reload and safe retry',async()=>{
  const h=harness();await h.mount();
  const response=deferred();h.network.push(response);
  let attempt;
  await act(async()=>{attempt=h.current.submit(request);});
  assert.equal(h.calls.length,1);
  assert.equal(h.current.blocked,true);
  assert.equal(h.entries.size,1);
  await act(async()=>{await h.current.submit(request);});
  assert.equal(h.calls.length,1,'double click cannot submit twice');
  await act(async()=>{response.resolve({data:null,error:{message:'network lost'}});await attempt;});
  assert.ok(h.current.pending);
  assert.equal(h.current.result,null);
  const original=JSON.stringify(h.calls[0].args);
  await h.unmount();await h.mount();
  assert.equal(h.current.blocked,true,'refresh restores unresolved operation');
  await act(async()=>{await h.current.submit({...request,wallet_id:randomUUID()});});
  assert.equal(h.calls.length,1,'cannot replace the wallet');
  const retry=deferred();h.network.push(retry);
  await act(async()=>{attempt=h.current.submit();});
  assert.equal(JSON.stringify(h.calls[1].args),original);
  await act(async()=>{retry.resolve({data:{status:'succeeded',transaction_id:randomUUID(),new_coin_balance:1250},error:null});await attempt;});
  assert.equal(h.current.result.status,'succeeded');assert.equal(h.current.pending,null);assert.equal(h.current.blocked,false);
  assert.equal(h.current.lastSale.transactionId,h.current.result.transaction_id);
  await h.unmount();await h.mount();
  assert.equal(h.current.lastSale.balanceAfter,1250,'last sale survives remount/refresh storage recovery');
  await h.unmount();
});

test('unreadable response keeps operation; definitive rejection unlocks a new payment',async()=>{
  const h=harness();await h.mount();
  for(const data of [{status:'succeeded'},{status:'rejected',message:'Insufficient coins'}]){
    const response=deferred();h.network.push(response);let attempt;
    await act(async()=>{attempt=h.current.submit(h.current.pending?undefined:request);});
    await act(async()=>{response.resolve({data,error:null});await attempt;});
  }
  assert.equal(h.current.result.status,'rejected');assert.equal(h.current.blocked,false);
  assert.equal(h.calls[0].args.p_operation_id,h.calls[1].args.p_operation_id);
  await h.unmount();
});

test('a response arriving after navigation reaches the newly mounted operator screen',async()=>{
  const h=harness();await h.mount();
  const response=deferred();h.network.push(response);let attempt;
  await act(async()=>{attempt=h.current.submit(request);});
  await h.unmount();await h.mount();
  assert.equal(h.current.blocked,true);
  const receipt={status:'succeeded',transaction_id:randomUUID(),new_coin_balance:1250};
  await act(async()=>{response.resolve({data:receipt,error:null});await attempt;});
  assert.equal(h.current.result.transaction_id,receipt.transaction_id);
  assert.equal(h.current.blocked,false);
  assert.equal(h.calls.length,1);
  await h.unmount();
  h.setUser({id:randomUUID()});await h.mount();
  assert.equal(h.current.result,null,'other operators cannot see the receipt');
  await h.unmount();
});

test('storage failure prevents any mutation and operator accounts cannot inherit pending requests',async()=>{
  const h=harness();await h.mount();h.failWrites();
  await act(async()=>{await h.current.submit(request);});assert.equal(h.calls.length,0);await h.unmount();
  const other=harness();await other.mount();const response=deferred();other.network.push(response);let attempt;
  await act(async()=>{attempt=other.current.submit(request);});
  await act(async()=>{response.resolve({data:null,error:{message:'offline'}});await attempt;});
  const original=other.calls[0].args.p_operation_id;await other.unmount();other.setUser({id:randomUUID()});await other.mount();
  assert.equal(other.current.pending,null);assert.equal(other.entries.size,1);
  await act(async()=>{await other.current.submit();});assert.equal(other.calls.length,1);assert.ok(original);
  await other.unmount();
});

test('void uses its own RPC, survives lost responses and marks the persistent receipt once',async()=>{
  const h=harness();await h.mount();
  const complete=async(req,data)=>{
    const response=deferred();h.network.push(response);let attempt;
    await act(async()=>{attempt=h.current.submit(req);});
    await act(async()=>{response.resolve({data,error:null});await attempt;});
  };
  const sale=randomUUID();
  await complete(request,{status:'succeeded',transaction_id:sale,new_coin_balance:1250});
  await complete(request,{status:'rejected',message:'Insufficient coins'});
  assert.equal(h.current.lastSale.transactionId,sale,'a rejected next sale preserves the receipt');
  await complete({kind:'topup',wallet_id:request.wallet_id,reference:'Receipt'},
    {status:'succeeded',transaction_id:randomUUID(),new_coin_balance:3250});
  assert.equal(h.current.lastSale.balanceAfter,1250,'top-ups do not replace the historical sale');
  const req={kind:'void',wallet_id:request.wallet_id,sale_transaction_id:sale,void_reason:'Wrong item'};
  await complete(req,null);
  const frozen=JSON.stringify(h.calls.at(-1));assert.equal(h.calls.at(-1).name,'void_pos_sale');
  await h.unmount();await h.mount();assert.equal(h.current.pending.request.kind,'void');
  const count=h.calls.length,response=deferred();h.network.push(response);let attempt;
  await act(async()=>{attempt=h.current.submit();await h.current.submit();});
  assert.equal(h.calls.length,count+1);assert.equal(JSON.stringify(h.calls.at(-1)),frozen);
  const refund=randomUUID();
  await act(async()=>{response.resolve({data:{status:'succeeded',transaction_id:refund,new_coin_balance:4000,
    voided_transaction_id:sale,credited_coin_amount:750},error:null});await attempt;});
  assert.equal(h.current.lastSale.refundTransactionId,refund);assert.equal(h.current.blocked,false);
  await h.unmount();await h.mount();assert.equal(h.current.lastSale.refundTransactionId,refund);
  await h.unmount();h.setUser({id:randomUUID()});await h.mount();assert.equal(h.current.lastSale,null);
  await h.unmount();
});
