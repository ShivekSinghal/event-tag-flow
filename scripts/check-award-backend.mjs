import { resolveBrowserSupabaseConfig } from '../src/integrations/supabase/browserConfig.mjs';
export async function checkAwardBackend(env, request=fetch) {
  if (env.VERCEL_ENV !== 'production') return;
  const {url,key}=resolveBrowserSupabaseConfig(env);
  const headers={apikey:key,'Content-Type':'application/json'};
  if (!key.startsWith('sb_publishable_')) headers.Authorization=`Bearer ${key}`;
  const response=await request(`${url}/rest/v1/rpc/direct_award_backend_version`,{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(15000)});
  if (response.status!==200 || await response.json()!==1) throw new Error('Direct award backend is missing; deploy the reviewed migration before merging.');
}
