import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

if (!process.env.PINKD_PLAYWRIGHT_ROOT) throw new Error('Set PINKD_PLAYWRIGHT_ROOT to the directory containing playwright.');
const { chromium } = createRequire(process.env.PINKD_PLAYWRIGHT_ROOT + '/package.json')('playwright');
const base = process.env.PINKD_TEST_URL || 'http://127.0.0.1:8094';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Localhost only.');
const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'operator@example.test' };
const a = '00000000-0000-0000-0000-000000000002';
const b = '00000000-0000-0000-0000-000000000003';
const pack = '00000000-0000-0000-0000-000000000004';
const order = 'cafe0001-0000-0000-0000-000000000001';
const lookup = { order_id: order, order_ref: 'CAFE0001', first_name: 'Alice', party_entries: 2, wallet_linked: true,
  bands: [{ wallet_id: a, name: 'Alice', band_hint: 'AAA', coin_balance: 100 }, { wallet_id: b, name: 'Bob', band_hint: 'BBB', coin_balance: 200 }] };
const link = id => `https://pinkd.hashtag.dance/coins?ref=CAFE0001&band=${id}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('/tmp/pinkd-ticket-qr-screens', { recursive: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const calls = [], errors = [];
    let unlinked = false, delayLookup = false, paymentStatus = 'paid';
    let releaseLookup;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      if (!url.hostname.endsWith('.supabase.co')) return route.abort();
      const json = body => route.fulfill({ json: body });
      const name = url.pathname.split('/').at(-1);
      calls.push({ name, body: route.request().postData() ? route.request().postDataJSON() : null });
      if (name === 'user') return json(user);
      if (name === 'profiles') return json({ ...user, full_name: 'Test operator', role: 'admin' });
      if (name === 'staff_permissions') return json([]);
      if (name === 'wallets') {
        const id = url.searchParams.get('id')?.slice(3) || a;
        return json({ id, event_order_id: unlinked ? null : order, status: 'active', tag_id: 'NFC04AA11223344', attendee_name: id === a ? 'Alice' : 'Bob', coin_balance: 100 });
      }
      if (name === 'lookup_party_order') {
        if (delayLookup) { delayLookup = false; await new Promise(resolve => { releaseLookup = resolve; }); }
        return json(lookup);
      }
      if (name === 'staff_find_wallet') return json([{ wallet_id: b, attendee_name: 'Bob', band_hint: 'BBB', coin_balance: 200, studio: 'RG', match_kind: 'name' }]);
      if (name === 'coin_packages') return json([{ id: pack, inr_amount: 2000, coin_amount: 2000, active: true, display_order: 0 }]);
      if (name === 'payment_gateway_settings') return json({ active_provider: 'cashfree' });
      if (name === 'create_coin_order_checkout') return json({ order_id: 'dddd0001-0000-0000-0000-000000000001', total_amount_inr: 2000 });
      if (name === 'event-payment-create') return json({ provider: 'cashfree', mode: 'sandbox', payment_session_id: 'mock-session', cashfree_order_id: 'mock-order' });
      if (name === 'event-payment-status') return json({ payment_status: paymentStatus, confirmation_email_sent: paymentStatus === 'paid' });
      if (name === 'execute_wallet_operation') return json({ status: 'rejected', message: 'Insufficient coins' });
      return json([]);
    });
    await context.addInitScript(user => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const access_token = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp })) + '.test';
      localStorage.setItem('sb-xdaienqjbybomctsoiro-auth-token', JSON.stringify({ access_token, refresh_token: 'test', expires_at: exp, token_type: 'bearer', user }));
      window.Cashfree = () => ({ checkout: async () => ({}) });
      // Browser-only NFC simulation; this does not verify physical Android hardware.
      window.NDEFReader = class {
        async scan() { window.testNfcReader = this; }
      };
    }, user);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(15000);
    const scan = async () => {
      await page.getByRole('button', { name: 'Scan NFC Tag' }).click();
      await page.waitForFunction(() => Boolean(window.testNfcReader?.onreading));
      await page.evaluate(() => window.testNfcReader.onreading({ serialNumber: '04:AA:11:22:33:44' }));
    };
    const qr = page.getByRole('region', { name: 'Online coin top-up' });
    const expectLink = async id => {
      await qr.locator(`a[href="${link(id)}"]`).waitFor();
      assert.equal(await qr.getByRole('link', { name: 'Open coin shop' }).getAttribute('href'), link(id));
      const img = qr.locator('img');
      await img.waitFor();
      assert.equal(await img.evaluate(el => el.complete && el.naturalWidth === 256), true);
      assert.match(await img.getAttribute('src'), /^data:image\/png;base64,/);
    };
    await page.goto(base + '/topup');
    await qr.locator('img').waitFor();
    // Vite dev serves local assets; the production build embeds this small PNG.
    assert.match(await qr.locator('img').getAttribute('src'), /^(data:image\/png;base64,|\/src\/assets\/coins-qr\.png)/);
    await scan();
    await expectLink(a);
    await qr.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/pinkd-ticket-qr-screens/topup-${width}.png` });
    assert.equal(await page.getByLabel('Confirmed Payment Reference').count(), 1, 'counter path retained');
    // Begin an old QR fetch, then replace the wallet through confirmed lookup.
    delayLookup = true;
    await scan();
    await qr.getByText('Checking ticket...').waitFor();
    await page.getByRole('button', { name: "Can't scan? Find by phone or name" }).click();
    await page.getByPlaceholder('Phone, name or order ref').fill('Bob');
    await page.getByRole('button', { name: /Bob.*matched by name/ }).click();
    await page.getByRole('button', { name: 'Use this band', exact: true }).click();
    await expectLink(b);
    if (releaseLookup) releaseLookup();
    await expectLink(b);
    unlinked = true;
    await scan();
    await qr.getByText(/not linked to a ticket/).waitFor();
    assert.equal(await qr.getByRole('link').count(), 0);
    unlinked = false;

    // Server-side insufficient-balance responses retain the attempted wallet for the QR.
    await page.evaluate(({ user, a }) => sessionStorage.setItem('pinkd.wallet-operation.v1:' + user.id, JSON.stringify({ version: 1, id: crypto.randomUUID(), operator: user.id,
      request: { kind: 'spend', wallet_id: a, coin_amount: 750, transaction_type: 'food', item_name: 'Food', reference: 'TEST' } })), { user, a });
    await page.goto(base + '/pos');
    await page.getByRole('button', { name: 'Check / Retry safely' }).click();
    await page.getByText("Insufficient Pink'd Coins", { exact: true }).waitFor();
    await expectLink(a);

    await page.goto(base + `/coins?ref=CAFE0001&band=${b}`);
    const confirmation = page.getByRole('checkbox');
    await confirmation.waitFor();
    await page.getByRole('button', { name: 'Add one 2000 coin pack' }).click();
    const pay = page.getByRole('button', { name: /^Pay / });
    assert.equal(await pay.isDisabled(), true);
    await confirmation.check();
    assert.equal(await pay.isEnabled(), true);
    await page.screenshot({ path: `/tmp/pinkd-ticket-qr-screens/band-confirm-${width}.png`, fullPage: true });
    await pay.click();
    await page.getByText(/are booked against order CAFE0001/).waitFor();
    const create = calls.find(call => call.name === 'create_coin_order_checkout');
    assert.equal(create.body.p_target_wallet_id, b);
    assert.equal(create.body.p_proof, 'CAFE0001');
    assert.equal(create.body.p_cart_items[0].coin_package_id, pack);
    assert.equal(calls.filter(call => call.name === 'event-payment-create').length, 1);
    assert.equal(calls.filter(call => call.name === 'event-payment-status').length, 1);
    assert.equal(calls.filter(call => call.name === 'event-payment-verify').length, 0);
    assert.equal(calls.filter(call => call.name === 'execute_wallet_operation').length, 1, 'shop does not credit manually');

    await page.goto(base + `/coins?ref=CAFE0001&band=${user.id}`);
    await page.getByRole('alert').filter({ hasText: /not available on this ticket/ }).waitFor();
    await page.getByRole('button', { name: 'Add one 2000 coin pack' }).click();
    assert.equal(await pay.isDisabled(), true, 'foreign band cannot fall through to another wallet');
    assert.equal(await confirmation.count(), 0);
    await page.getByRole('button', { name: /Bob.*BBB/ }).click();
    await confirmation.check();
    paymentStatus = 'failed';
    await pay.click();
    await page.getByText(/hasn't confirmed this payment yet/).waitFor();
    assert.equal(await page.getByText(/are booked against order CAFE0001/).count(), 0);
    await page.getByRole('button', { name: 'Not you?' }).click();
    assert.equal(new URL(page.url()).searchParams.has('band'), false);
    assert.equal(new URL(page.url()).searchParams.has('ref'), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`${width}px: generic/personal QR, scan/lookup, stale result, unlinked band, POS insufficient, crew confirmation and paid/failed gateway UI passed (all APIs mocked).`);
    await context.close();
  }
} finally { await browser.close(); }
