import { resolveBrowserSupabaseConfig } from '../src/integrations/supabase/browserConfig.mjs';
export async function checkCashBackend(env, request=fetch) {
  if (env.VERCEL_ENV !== 'production') return;
  const {url,key}=resolveBrowserSupabaseConfig(env);
  const headers={apikey:key,'Content-Type':'application/json'};
  if (!key.startsWith('sb_publishable_')) headers.Authorization=`Bearer ${key}`;
  const db=await request(`${url}/rest/v1/rpc/cash_backend_version`,{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(15000)});
  if (db.status!==200 || await db.json()!==1) throw new Error('Cash migration readiness check failed; deploy the reviewed backend before merging.');
  const edge=await request(`${url}/functions/v1/cash-booking`,{headers,signal:AbortSignal.timeout(15000)});
  const body=await edge.json();
  if (edge.status!==200 || body.ready!==true || body.cash_version!==1) throw new Error('Cash Edge Function or required email secrets are not ready.');
}
