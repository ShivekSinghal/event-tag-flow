import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Webhook} from 'standardwebhooks';
import ts from 'typescript';

const source=readFileSync('supabase/functions/send-auth-email/handler.ts','utf8');
const {buildAuthEmails,createAuthEmailHandler}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(source,{module:ts.ModuleKind.ESNext})).toString('base64'));
const config={configured:true,supabaseUrl:'https://project.supabase.co',siteUrl:'https://pinkd.hashtag.dance'};
const secret=randomBytes(32).toString('base64');

test('Auth configuration accepts empty successful secret responses before enabling the hook',()=>{
 const script=readFileSync('scripts/configure-auth-email.mjs','utf8');
 const harness=`
 process.argv.push('--apply','--approved-project','xdaienqjbybomctsoiro');
 process.env.SUPABASE_ACCESS_TOKEN='test-only';
 let config={site_url:'https://old.example',hook_send_email_enabled:false,rate_limit_email_sent:2};
 let calls=0;
 globalThis.fetch=async(url,options={})=>{
   calls++;
   if(url.endsWith('/secrets'))return new Response(null,{status:200});
   if(url.endsWith('/functions/v1/send-auth-email'))return new Response(null,{status:401});
   if(url.endsWith('/config/auth')){
     if(options.method==='PATCH')config={...config,...JSON.parse(options.body)};
     return Response.json(config);
   }
   throw Error('Unexpected network request');
 };
 await import('data:text/javascript;base64,${Buffer.from(script).toString('base64')}');
 if(calls!==5 || !config.hook_send_email_enabled || config.mailer_otp_exp!==3600)throw Error('Configuration incomplete');
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',harness],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.ok(!result.stdout.includes('whsec_'));
});
const verifier=new Webhook(secret);
const payload=(action='recovery')=>({user:{email:'staff@example.test'},email_data:{email_action_type:action,token_hash:'a'.repeat(64),token:'123456',redirect_to:'https://evil.example',site_url:'https://evil.example'}});
function signed(value=payload(),date=new Date(),id='test-message') {
 const body=JSON.stringify(value);
 return new Request('https://project.supabase.co/functions/v1/send-auth-email',{method:'POST',body,headers:{'webhook-id':id,'webhook-timestamp':String(Math.floor(date.getTime()/1000)),'webhook-signature':verifier.sign(id,date,body)}});
}
function fixture(send=async()=>{}) {return createAuthEmailHandler({...config,verify:(body,headers)=>verifier.verify(body,headers),send});}

test('unsigned, tampered and old webhook requests never send email',async()=>{
 let calls=0;const handler=fixture(async()=>{calls++});
 assert.equal((await handler(new Request('https://test',{method:'POST',body:JSON.stringify(payload())}))).status,401);
 const original=signed(); const tampered=new Request(original.url,{method:'POST',headers:original.headers,body:JSON.stringify(payload('signup'))});
 assert.equal((await handler(tampered)).status,401);
 assert.equal((await handler(signed(payload(),new Date(Date.now()-600000)))).status,401);
 assert.equal(calls,0);
});
test('signed recovery sends branded content to the correct recipient and trusted reset URL',async()=>{
 let message,key;const handler=fixture(async(m,k)=>{message=m;key=k});
 assert.equal((await handler(signed())).status,200);
 assert.deepEqual(message.to,['staff@example.test']); assert.match(message.subject,/Reset.*Pink'D/);
 const url=new URL(message.text.split('\n\n')[2]);
 assert.equal(url.origin,config.supabaseUrl);assert.equal(url.pathname,'/auth/v1/verify');
 assert.equal(url.searchParams.get('type'),'recovery');
 assert.equal(url.searchParams.get('redirect_to'),config.siteUrl+'/reset-password');
 assert.ok(!message.html.includes('evil.example')); assert.ok(!message.html.includes('onboarding@resend.dev'));
 assert.match(key,/^pinkd-auth-[a-f0-9]{64}$/);
});
test('retries reuse a provider idempotency key and distinct messages do not collide',async()=>{
 const keys=[];const handler=fixture(async(m,k)=>keys.push(k));
 await handler(signed());await handler(signed());await handler(signed(payload(),new Date(),'second-message'));
 assert.equal(keys[0],keys[1]);assert.notEqual(keys[0],keys[2]);
});
test('provider errors return failure without leaking recipients or credentials',async()=>{
 const response=await fixture(async()=>{throw new Error('secret-token staff@example.test')})(signed());
 assert.equal(response.status,502);const body=await response.text();assert.ok(!body.includes('secret-token'));assert.ok(!body.includes('staff@example.test'));
});
test('all existing account actions keep their proper destinations',()=>{
 for(const action of ['signup','invite','magiclink']) {
  const [message]=buildAuthEmails(payload(action),config);const url=new URL(message.text.split('\n\n')[2]);
  assert.equal(url.searchParams.get('type'),action);
  assert.equal(url.searchParams.get('redirect_to'),config.siteUrl+(action==='invite'?'/reset-password':'/pinkd-login'));
 }
 assert.match(buildAuthEmails(payload('reauthentication'),config)[0].text,/123456/);
});
test('secure email change maps old and new hashes to the correct recipients',()=>{
 const data=payload('email_change');data.user.new_email='new@example.test';data.email_data.token_hash_new='b'.repeat(64);
 const messages=buildAuthEmails(data,config);
 assert.deepEqual(messages.map(m=>m.to[0]),['staff@example.test','new@example.test']);
 assert.equal(new URL(messages[0].text.split('\n\n')[2]).searchParams.get('token'),'b'.repeat(64));
 assert.equal(new URL(messages[1].text.split('\n\n')[2]).searchParams.get('token'),'a'.repeat(64));
 delete data.email_data.token_hash_new;
 assert.deepEqual(buildAuthEmails(data,config).map(m=>m.to[0]),['new@example.test']);
});
test('invalid payload, method, missing configuration and oversized requests fail closed',async()=>{
 let sends=0;const handler=fixture(async()=>{sends++});
 assert.equal((await handler(new Request('https://test'))).status,405);
 for(const data of [null,{},payload('unknown'),{...payload(),user:{email:'<script>@example.test'}}]) assert.equal((await handler(signed(data))).status,400);
 assert.equal((await handler(signed({padding:'a'.repeat(70000)}))).status,413);
 assert.equal((await createAuthEmailHandler({...config,configured:false})(signed())).status,503);
 assert.equal(sends,0);
});
test('email handler contains no token-bearing debug logging',()=>{
 assert.ok(!source.includes('console.'));
 assert.ok(!readFileSync('supabase/functions/send-auth-email/index.ts','utf8').includes('console.'));
});
