import assert from 'node:assert/strict';
import test from 'node:test';
import { checkWalletBackend } from './check-wallet-backend.mjs';
import { resolveBrowserSupabaseConfig } from '../src/integrations/supabase/browserConfig.mjs';

const env = { VERCEL_ENV: 'production' };
const reply = (status, body) => async () => ({ status, json: async () => body });
test('local and preview builds do not probe production', async () => {
  for (const value of [{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }]) {
    assert.equal((await checkWalletBackend(value, () => { throw Error('Unexpected request'); })).skipped, true);
  }
});
test('production accepts only a named anonymous permission denial', async () => {
  let calls = 0;
  const result = await checkWalletBackend(env, async (url, options) => {
    calls++;
    assert.equal(url, resolveBrowserSupabaseConfig(env).url + '/rest/v1/rpc/execute_wallet_operation');
    assert.deepEqual(JSON.parse(options.body), { p_operation_id: null, p_request: null });
    return { status: 401, json: async () => ({ code: '42501', message: 'permission denied for function execute_wallet_operation' }) };
  });
  assert.equal(calls, 1); assert.equal(result.skipped, false);
});
test('missing RPC, wrong credentials, public access and malformed replies stop production builds', async () => {
  for (const [status, body] of [[404, { code: 'PGRST202' }], [401, { code: '42501', message: 'Invalid key' }], [200, {}], [500, {}]]) {
    await assert.rejects(checkWalletBackend(env, reply(status, body)), /release blocked/);
  }
  await assert.rejects(checkWalletBackend(env, async () => { throw Error('network error'); }), /network error/);
  await assert.rejects(checkWalletBackend(env, async () => ({ status: 401, json: async () => { throw Error('invalid JSON'); } })), /invalid JSON/);
});
test('privileged keys and unknown Vercel environments fail without a request', async () => {
  const key = 'header.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.signature';
  await assert.rejects(checkWalletBackend({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key }), /privileged key/);
  await assert.rejects(checkWalletBackend({ VERCEL: '1' }), /environment/);
});
test('guard follows the same Vite overrides as the browser', () => {
  assert.deepEqual(resolveBrowserSupabaseConfig({ VITE_SUPABASE_URL: ' https://staging.example ', VITE_SUPABASE_ANON_KEY: ' key ' }), { url: 'https://staging.example', key: 'key' });
});
