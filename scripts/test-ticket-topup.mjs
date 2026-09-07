import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import QRCode from 'qrcode';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/ticketTopUp.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, { exports, URL });
const { COINS_URL, ticketReference, ticketTopUpUrl, selectLinkedBand, isLinkedTicket } = exports;
const order = 'cafe0001-0000-0000-0000-000000000001';
const a = '00000000-0000-0000-0000-000000000002';
const b = '00000000-0000-0000-0000-000000000003';
const bands = [{ wallet_id: a }, { wallet_id: b }];

test('QR link uses the existing eight-character ticket proof and only a band ID hint', () => {
  assert.equal(ticketReference(order), 'CAFE0001');
  assert.equal(ticketTopUpUrl(order, b), `${COINS_URL}?ref=CAFE0001&band=${b}`);
  assert.equal(ticketReference(null), null);
  assert.equal(ticketReference('NFC04AA11223344'), null);
  assert.throws(() => ticketTopUpUrl(order, 'phone-or-tag'));
  assert.throws(() => ticketTopUpUrl('CAFE0001', b));
});
test('a crew band hint cannot select a wallet outside returned active bands', () => {
  assert.equal(selectLinkedBand(bands, b, a), b);
  assert.equal(selectLinkedBand(bands, 'foreign', a), null);
  assert.equal(selectLinkedBand([{ wallet_id: a }], 'foreign', a), null);
  assert.equal(selectLinkedBand([], b, b), null);
});
test('generic/email lookup retains matched, sole-band and crew selection rules', () => {
  assert.equal(selectLinkedBand(bands, null, b), b);
  assert.equal(selectLinkedBand(bands, null, null), null);
  assert.equal(selectLinkedBand([{ wallet_id: a }], null, null), a);
});
test('staff QR requires an exact ticket match and a returned active band', () => {
  assert.equal(isLinkedTicket({ order_id: order, bands }, order, a), true);
  assert.equal(isLinkedTicket({ order_id: 'other', bands }, order, a), false);
  assert.equal(isLinkedTicket({ order_id: order, bands: [] }, order, a), false);
  assert.equal(isLinkedTicket(null, order, a), false);
});
test('generic QR remains an embedded 256px PNG for the canonical coin-shop URL', async () => {
  const png = readFileSync('src/assets/coins-qr.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
  assert.deepEqual(png, await QRCode.toBuffer(COINS_URL, { width: 256, margin: 4, errorCorrectionLevel: 'M' }));
  assert.match(readFileSync('src/components/wallet/TicketTopUpQr.tsx', 'utf8'), /coins-qr\.png\?inline/);
});
