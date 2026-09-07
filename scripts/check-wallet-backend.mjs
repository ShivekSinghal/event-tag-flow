import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';
import { resolveBrowserSupabaseConfig } from '../src/integrations/supabase/browserConfig.mjs';
import { checkAwardBackend } from './check-award-backend.mjs';

export async function checkWalletBackend(env, request = fetch) {
  if (!env.VERCEL_ENV && !env.VERCEL) return { skipped: true };
  if (env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development') return { skipped: true };
  if (env.VERCEL_ENV !== 'production') throw new Error('Cannot determine Vercel deployment environment; refusing an unchecked build.');
  const { url, key } = resolveBrowserSupabaseConfig(env);
  if (new URL(url).protocol !== 'https:') throw new Error('Production Supabase URL must use HTTPS.');
  // Never use an operator token or privileged key for this non-mutating probe.
  const publishable = key.startsWith('sb_publishable_');
  if (!publishable) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* Rejected below. */ }
    if (role !== 'anon') throw new Error('The browser Supabase key must be anonymous/publishable, not a privileged key.');
  }
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!publishable) headers.Authorization = `Bearer ${key}`;
  for (const name of ['execute_wallet_operation', 'void_pos_sale']) {
    const response = await request(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify({ p_operation_id: null, p_request: null }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    // A named permission denial proves the RPC exists and still rejects anon.
    // Missing RPC, network/auth failures and unexpected public access all block release.
    if (![401, 403].includes(response.status) || body.code !== '42501'
      || body.message !== `permission denied for function ${name}`) {
      throw new Error(`Production release blocked: ${name} is missing or its anonymous access check failed. Apply and validate the wallet retry and POS void migrations, then redeploy.`);
    }
  }
  return { skipped: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const outcome = await checkWalletBackend({ ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env });
    await checkAwardBackend({ ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env });
    console.log(outcome.skipped ? 'Production backend gate not required for this local/preview build.' : 'Production retry and POS void RPCs are present and protected.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Backend readiness check failed.');
    process.exitCode = 1;
  }
}
