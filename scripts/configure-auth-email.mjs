import {randomBytes} from 'node:crypto';

const project='xdaienqjbybomctsoiro';
const token=process.env.SUPABASE_ACCESS_TOKEN;
const apply=process.argv.includes('--apply');
if(!token) throw new Error('Provide SUPABASE_ACCESS_TOKEN through a protected environment.');
if(apply && process.argv[process.argv.indexOf('--approved-project')+1]!==project) throw new Error('Explicit approved project is required.');
const base=`https://api.supabase.com/v1/projects/${project}`;
const endpoint=`https://${project}.supabase.co/functions/v1/send-auth-email`;
async function management(path,method='GET',body) {
 const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!response.ok) throw new Error(`Management API ${method} ${path} failed (${response.status}); no secret values logged.`);
 const text=await response.text();
 return text ? JSON.parse(text) : null;
}
const current=await management('/config/auth');
const summary=value=>({site_url:value.site_url,email_hook_enabled:value.hook_send_email_enabled,email_hook_uri:value.hook_send_email_uri,custom_smtp_configured:Boolean(value.smtp_host),otp_expiry_seconds:value.mailer_otp_exp,emails_per_hour:value.rate_limit_email_sent});
if(!apply) {
 console.log(JSON.stringify({mode:'read-only',current:summary(current),pending:'Deploy the secured send-auth-email function before applying this configuration.'},null,2));
} else {
 if(current.hook_send_email_enabled) throw new Error('An email hook is already active. Review it instead of rotating its secret automatically.');
 // Preserve all unrelated Auth settings and existing allowed redirects.
 const redirects=new Set((current.uri_allow_list||'').split(',').map(s=>s.trim()).filter(Boolean));
 redirects.add('https://pinkd.hashtag.dance/reset-password');
 redirects.add('https://pinkd.hashtag.dance/pinkd-login');
 const secret=`v1,whsec_${randomBytes(32).toString('base64')}`;
 await management('/secrets','POST',[{name:'SEND_EMAIL_HOOK_SECRET',value:secret}]);
 // Fail closed unless the deployed function rejects unsigned requests, without sending.
 let protectedEndpoint=false;
 for(let i=0;i<6;i++) {
  const probe=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(probe.status===401){protectedEndpoint=true;break;}
  if(i<5) await new Promise(resolve=>setTimeout(resolve,2000));
 }
 if(!protectedEndpoint) throw new Error('Secured email endpoint not ready. Auth hook remains disabled. Check function deployment and sender secrets.');
 await management('/config/auth','PATCH',{
  site_url:'https://pinkd.hashtag.dance',
  uri_allow_list:[...redirects].join(','),
  mailer_otp_exp:3600,
  rate_limit_email_sent:Math.max(Number(current.rate_limit_email_sent)||0,60),
  hook_send_email_enabled:true,
  hook_send_email_uri:endpoint,
  hook_send_email_secrets:secret,
 });
 const verified=await management('/config/auth');
 if(!verified.hook_send_email_enabled || verified.hook_send_email_uri!==endpoint || verified.site_url!=='https://pinkd.hashtag.dance') throw new Error('Auth configuration readback mismatch. Inspect before testing recovery.');
 console.log(JSON.stringify({mode:'applied',verified:summary(verified),pending:'Test a real authorized password-reset recipient; configuration alone does not prove inbox delivery.'},null,2));
}
