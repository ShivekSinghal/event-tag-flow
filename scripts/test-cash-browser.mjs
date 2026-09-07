import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PINKD_PLAYWRIGHT_ROOT + '/package.json')('playwright');
const base = process.env.PINKD_TEST_URL || 'http://127.0.0.1:8095';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local mocks only');
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'manager@example.test' };
const order = '00000000-0000-4000-8000-000000000002';
const studio = 'Rajouri Garden (RG)';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const role of ['studio_manager', 'admin', 'staff']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const calls = [], errors = [];
    let confirmed = false, codeSent = false;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (!url.hostname.endsWith('.supabase.co')) return route.abort();
      const name = url.pathname.split('/').at(-1);
      const body = route.request().postData() ? route.request().postDataJSON() : null;
      const json = value => route.fulfill({ json: value });
      if (name === 'user') return json(user);
      if (name === 'profiles') return json(url.searchParams.has('role') ? [] : { ...user, full_name: 'Test Manager', role });
      if (name === 'cash_studios') return json([{ name: studio }]);
      if (name === 'cash_manager_studios') return json([{ user_id: user.id, studio }]);
      if (name === 'list_cash_desk_orders') return json([{ order_id: order, order_ref: '00000000', customer_name: 'Test Student', customer_phone_hint: '***123', customer_email: 'student@example.test', customer_studio: 'Not a Student', cash_studio: studio, total_amount_inr: 2000, payment_status: confirmed ? 'paid' : 'manual_payment', items: 'Party Entry x1', hold_expires_at: new Date(Date.now() + 300000).toISOString(), confirmed_at: confirmed ? new Date().toISOString() : null, cancelled_at: null, code_sent: codeSent, notifications: confirmed ? [{ kind: 'confirmation', status: 'error', error: 'Test delivery failure' }] : [] }]);
      if (name === 'cash-booking') {
        calls.push(body);
        if (body.action === 'request_code') codeSent = true;
        if (body.action === 'confirm') { assert.equal(body.code, '123456'); confirmed = true; }
        return json({ status: 'succeeded', confirmed, notifications: [{ status: 'error' }] });
      }
      return json([]);
    });
    await context.addInitScript(user => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('sb-xdaienqjbybomctsoiro-auth-token', JSON.stringify({ access_token: btoa('{}') + '.' + btoa(JSON.stringify({ sub: user.id, exp })) + '.test', refresh_token: 'test', expires_at: exp, token_type: 'bearer', user }));
    }, user);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/cash-booking');
    if (role === 'staff') {
      await page.getByText('Cash Desk is for admins and assigned studio managers.').waitFor();
      assert.equal(calls.length, 0);
    } else {
      await page.getByRole('button', { name: 'Send code', exact: true }).click();
      await page.getByRole('button', { name: 'Resend code', exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Code for 00000000' }).fill('123456');
      await page.getByRole('button', { name: 'Confirm cash received' }).click();
      await page.getByText(/Cash payment recorded. Do not collect again/).waitFor();
      await page.getByRole('tab', { name: 'Cash reconciliation' }).click();
      await page.getByText('Test delivery failure', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Retry notifications' }).click();
      await page.getByRole('button', { name: 'Check / Retry safely' }).waitFor({ state: 'hidden' });
      assert.equal(calls.filter(c => c.action === 'confirm').length, 1);
      assert.equal(new Set(calls.map(c => c.operation_id)).size, calls.length);
      const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
      assert.equal(stored.includes('123456'), false, 'OTP never persisted');
      assert.equal(await page.getByText('Manager studio assignments', { exact: true }).count(), role === 'admin' ? 1 : 0);
      await page.screenshot({ path: `/tmp/pinkd-cash-${role}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS mocked ${role} Cash Desk`);
    await context.close();
  }
} finally { await browser.close(); }
