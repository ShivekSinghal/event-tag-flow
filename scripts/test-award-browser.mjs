import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PINKD_PLAYWRIGHT_ROOT + '/package.json')('playwright');
const base = process.env.PINKD_TEST_URL || 'http://127.0.0.1:8096';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local mocks only');
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'operator@example.test' };
const game = { id: '00000000-0000-4000-8000-000000000002', name: 'Hurdle', price: 750, available: true, awards_pinkredible: true, studio: 'RG' };
const wallet = { id: '00000000-0000-4000-8000-000000000003', attendee_name: 'Test Winner', status: 'active', tag_id: 'NFC04AA11223344', coin_balance: 1000 };
const entry = '00000000-0000-4000-8000-000000000004';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const role of ['admin', 'staff', 'studio_manager']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const calls = [], errors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (!url.hostname.endsWith('.supabase.co')) return route.abort();
      const name = url.pathname.split('/').at(-1), json = value => route.fulfill({ json: value });
      if (name === 'user') return json(user);
      if (name === 'profiles') return json({ ...user, full_name: 'Test Operator', role });
      if (name === 'games') return json([game]);
      if (name === 'staff_permissions') return json([{ id: entry, game_id: game.id, permission_type: 'game', game }]);
      if (name === 'wallets') return json(wallet);
      if (name === 'eligible_pinkredible_entries') return json([{ transaction_id: entry, created_at: new Date().toISOString(), coin_amount: 750 }]);
      if (name === 'award_pinkredible') {
        const body = route.request().postDataJSON(); calls.push(body);
        assert.deepEqual(body.p_request, { wallet_id: wallet.id, game_id: game.id, entry_transaction_id: entry });
        return json({ status: 'succeeded', award_id: crypto.randomUUID(), entry_transaction_id: entry, first_name: 'Test Winner', game: 'Hurdle', pinkredibles: 1, code: 'PINK-ABC123' });
      }
      return json([]);
    });
    await context.addInitScript(user => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-xdaienqjbybomctsoiro-auth-token', JSON.stringify({ access_token: btoa('{}') + '.' + btoa(JSON.stringify({ sub: user.id, exp })) + '.test', refresh_token: 'test', expires_at: exp, token_type: 'bearer', user }));
      window.NDEFReader = class { async scan() { window.testNfcReader = this; } };
    }, user);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/pos');
    await page.getByRole('button', { name: /^(Games|🎮)$/ }).click();
    try { await page.getByRole('button', { name: 'Award Pinkredible for Hurdle' }).click({ timeout: 10000 }); }
    catch (error) { console.error(await page.locator('body').innerText(), errors); throw error; }
    await page.waitForFunction(() => Boolean(window.testNfcReader?.onreading));
    await page.evaluate(() => window.testNfcReader.onreading({ serialNumber: '04:AA:11:22:33:44' }));
    await page.getByLabel('Eligible paid entry').waitFor();
    await page.getByRole('button', { name: /^Award 🏆$/ }).click();
    await page.getByText('Last Pinkredible · Hurdle', { exact: true }).waitFor();
    assert.equal(calls.length, 1);
    await page.reload();
    await page.getByText('Last Pinkredible · Hurdle', { exact: true }).waitFor();
    assert.equal(calls.length, 1, 'refresh does not issue another award');
    await page.screenshot({ path: `/tmp/pinkd-award-${role}.png`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log(`PASS mocked ${role} award receipt and refresh`);
    await context.close();
  }
} finally { await browser.close(); }
