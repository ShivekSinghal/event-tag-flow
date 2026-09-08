import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

// Deliberately separate from migrations: never creates an account during builds/tests.
const project = 'xdaienqjbybomctsoiro';
const email = 'thakur.akash4796@gmail.com';
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
if (!args.includes('--apply') || !args.includes('--approved-project') || value('--approved-project') !== project || !args.includes('--credentials-out')) {
  throw new Error('Release approval required: --apply --approved-project xdaienqjbybomctsoiro --credentials-out /private/path/akash.json');
}
const output = value('--credentials-out');
if (!isAbsolute(output) || !relative(process.cwd(), resolve(output)).startsWith('..')) throw new Error('Store credentials outside the repository using an absolute private path.');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error('Provide SUPABASE_SERVICE_ROLE_KEY through the environment; never command-line arguments.');
const client = createClient(`https://${project}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: existing, error: lookupError } = await client.from('profiles').select('id,role').eq('email', email).maybeSingle();
if (lookupError) throw new Error('Cannot safely check the existing profile; no account changed.');
if (existing) {
  if (existing.role !== 'staff') throw new Error('Existing account is not staff; review manually. No roles changed.');
  console.log('Akash already has a staff profile. Password and permissions were not changed.');
  process.exit(0);
}
mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
if (statSync(dirname(output)).mode & 0o077) throw new Error('Credential directory must have mode 700.');
if (existsSync(output)) {
  const prior = JSON.parse(readFileSync(output, 'utf8'));
  if (prior.email === email) throw new Error('A prior provisioning attempt exists. Review its Auth/profile status before retrying; do not reset or create again blindly.');
  throw new Error('Credential path already exists; refusing to overwrite.');
}
const password = randomBytes(24).toString('base64url') + '!a7';
writeFileSync(output, JSON.stringify({ email, password, status: 'attempting', created_at: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 });
const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Akash Thakur' } });
if (error || !data.user) throw new Error('Account creation did not return a confirmed result. Review the private attempt file and Auth before retrying.');
const { data: profile, error: profileError } = await client.from('profiles').select('id,role,email').eq('id', data.user.id).single();
if (profileError || profile.role !== 'staff' || profile.email !== email) throw new Error('Auth account exists but staff profile verification failed. No permissions granted. Review before release.');
writeFileSync(output, JSON.stringify({ email, password, user_id: data.user.id, status: 'verified-staff', created_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
console.log(`Staff account verified. Share its initial password privately from ${output}. No game or cash permissions were granted by this script.`);
