import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = process.env.PINKD_TEST_ROOT || process.cwd();
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function scannerHarness() {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const readers = [];
  const states = [];
  const schedule = (fn, delay, repeat = false) => {
    timers.set(++id, { fn, at: now + delay, delay, repeat });
    return id;
  };
  class Reader {
    permission = deferred();
    constructor() { readers.push(this); }
    scan({ signal }) { this.signal = signal; return this.permission.promise; }
    read() { this.onreading?.({ serialNumber: 'aa:bb:cc:dd' }); }
  }
  const context = vm.createContext({
    exports: {}, AbortController,
    console: { log() {}, warn() {}, error() {} },
    navigator: { userAgent: 'test', platform: 'test', vibrate() {} },
    window: { NDEFReader: Reader, location: { href: 'http://test.invalid' } },
    Date: { now: () => now },
    setTimeout: (fn, delay) => schedule(fn, delay),
    clearTimeout: (key) => timers.delete(key),
    setInterval: (fn, delay) => schedule(fn, delay, true),
    clearInterval: (key) => timers.delete(key),
  });
  vm.runInContext(compile(read('src/utils/nfc.ts').replaceAll('import.meta.env', '({DEV:false})')), context);
  const manager = new context.exports.NFCManager();
  manager.setScanStateCallback((state) => states.push(state));
  return {
    manager, readers, timers, states,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [key, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.delay;
        else timers.delete(key);
        timer.fn();
      }
      now = end;
    },
  };
}

const posSource = read('src/pages/POS.tsx');
const posAST = ts.createSourceFile('POS.tsx', posSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pos = posAST.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'POS');
const handlerNames = [
  'handleScanForPayment', 'cancelSaleScan', 'retrySaleScan', 'handleLookupSelect', 'processPayment', 'resetTransaction',
  'findWalletByTag', 'scanBand', 'cancelRoundScan', 'payRoundPlayer', 'payPlayerByTag', 'handleRoundLookupSelect',
  'scanPlayerForRound', 'awardWinner', 'awardWinnerByTag', 'scanWinnerBand', 'closeRoundNoWinner',
];
// Execute the actual component handlers with fake I/O. No copy of the payment/scan logic
// lives in the tests, and no Supabase connection or real debit is made.
const handlerStatements = pos.body.statements.filter((node) => ts.isVariableStatement(node)
  && node.declarationList.declarations.some((declaration) => handlerNames.includes(declaration.name.getText(posAST))));
const availableNames = handlerStatements.flatMap((node) => node.declarationList.declarations.map((d) => d.name.getText(posAST)));
const wallet = { id: 'wallet-a', attendee_name: 'Test', attendee_phone: '0000000000', tag_id: 'NFC-AABBCCDD', coin_balance: 2000, status: 'active' };

function posHarness() {
  const scanner = scannerHarness();
  const calls = [];
  const messages = [];
  const responses = [];
  const payment = deferred();
  const context = {
    console: { error() {} }, nfcManager: scanner.manager,
    pendingSaleRef: { current: null }, scanGenerationRef: { current: 0 }, roundScanGenerationRef: { current: 0 },
    paymentInFlightRef: { current: false }, selectedGame: { id: 'game-a', name: 'Game', price: 750 },
    selectedDrink: null, selectedCustomItem: null, isScanning: false, isProcessing: false,
    lookupActive: false, lookupKey: 0,
    activeRound: { round_id: 'round-a', game_name: 'Game', entry_coins: 750, players_paid: 1, players_needed: 2 },
    parseRound: (value) => value,
    formatCoins: String, getCoinBalance: (row) => row.coin_balance,
    getErrorDetail: (error, key) => error?.[key], LOOKUP_REFERENCE_TAG: 'via:phone-lookup',
    toast: (message) => messages.push(message), addCard() {},
    supabase: {
      from() {
        const query = {
          select() { return query; }, eq() { return query; },
          single() { return responses.shift()?.promise || Promise.resolve({ data: wallet, error: null }); },
          maybeSingle() { return query.single(); },
        };
        return query;
      },
      rpc(name, args) {
        calls.push({ name, args });
        return { single: () => payment.promise, then: (...args) => payment.promise.then(...args) };
      },
    },
  };
  for (const name of ['IsScanning', 'LookupActive', 'LookupKey', 'ScannedWallet', 'IsProcessing', 'SelectedGame',
    'SelectedDrink', 'SelectedCustomItem', 'ShowCustomAmountInput', 'CustomAmount', 'ActiveRound', 'IsPickingWinner', 'IsAwarding']) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = (value) => { context[key] = typeof value === 'function' ? value(context[key]) : value; };
  }
  vm.createContext(context);
  vm.runInContext(compile(handlerStatements.map((s) => s.getText(posAST)).join('\n')
    + `\nglobalThis.handlers = {${availableNames.join(',')}};`), context);
  return { scanner, context, handlers: context.handlers, calls, messages, responses, payment };
}

test('opening lookup aborts NFC and keeps the sale beyond 30 seconds; confirmation debits once', async () => {
  const h = posHarness();
  const scan = h.handlers.handleScanForPayment(750, 'Game', 'game-a', 'games');
  const reader = h.scanner.readers[0];
  const lateRead = reader.onreading;
  h.handlers.cancelSaleScan();
  assert.equal(reader.signal.aborted, true);
  h.scanner.advance(31000);
  reader.permission.resolve();
  lateRead({ serialNumber: 'aa:bb:cc:dd' });
  await scan;
  assert.equal(h.context.pendingSaleRef.current.price, 750);
  assert.equal(h.context.lookupActive, true);
  assert.equal(h.scanner.timers.size, 0);
  assert.equal(h.messages.length, 0);
  const first = h.handlers.handleLookupSelect({ wallet_id: wallet.id });
  const second = h.handlers.handleLookupSelect({ wallet_id: wallet.id });
  await flush();
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].args.p_reference, /via:phone-lookup/);
  assert.equal(h.handlers.cancelSaleScan(), false, 'cannot take over an already submitted debit');
  h.payment.resolve({ data: { new_coin_balance: 1250 }, error: null });
  await Promise.all([first, second]);
  await h.handlers.handleLookupSelect({ wallet_id: wallet.id });
  assert.equal(h.calls.length, 1);
  assert.equal(h.context.pendingSaleRef.current, null);
});

test('lookup cancels an NFC wallet request already in flight', async () => {
  const h = posHarness();
  const response = deferred();
  h.responses.push(response);
  const scan = h.handlers.handleScanForPayment(750, 'Game', 'game-a', 'games');
  h.scanner.readers[0].read();
  await flush();
  h.handlers.cancelSaleScan();
  response.resolve({ data: wallet, error: null });
  await scan;
  assert.equal(h.calls.length, 0);
  assert.equal(h.context.lookupActive, true);
  assert.equal(h.context.pendingSaleRef.current.itemName, 'Game');
});

test('timeout retains the sale; explicit retry scans normally and invalidates pending manual lookup', async () => {
  const h = posHarness();
  const scan = h.handlers.handleScanForPayment(750, 'Game', 'game-a', 'games');
  h.scanner.advance(7000);
  await scan;
  assert.equal(h.context.pendingSaleRef.current.price, 750);
  assert.equal(h.context.isScanning, false);
  const response = deferred();
  h.responses.push(response);
  const manual = h.handlers.handleLookupSelect({ wallet_id: wallet.id });
  h.handlers.retrySaleScan();
  response.resolve({ data: wallet, error: null });
  await manual;
  assert.equal(h.calls.length, 0);
  assert.equal(h.context.lookupActive, false);
  h.scanner.readers[1].read();
  await flush();
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.calls[0].args.p_reference, /via:phone-lookup/);
  h.payment.resolve({ data: { new_coin_balance: 1250 }, error: null });
  await flush();
});

for (const row of [{ ...wallet, status: 'blocked' }, { ...wallet, coin_balance: 10 }]) {
  for (const mode of ['nfc', 'lookup']) {
    test(`${mode} rejects ${row.status === 'blocked' ? 'blocked' : 'insufficient'} wallet without a debit`, async () => {
      const h = posHarness();
      const response = deferred();
      h.responses.push(response);
      const scan = h.handlers.handleScanForPayment(750, 'Game', 'game-a', 'games');
      let attempt = scan;
      if (mode === 'lookup') {
        h.handlers.cancelSaleScan();
        attempt = h.handlers.handleLookupSelect({ wallet_id: row.id });
      } else h.scanner.readers[0].read();
      response.resolve({ data: row, error: null });
      await attempt;
      await scan;
      assert.equal(h.calls.length, 0);
      assert.equal(h.context.pendingSaleRef.current.price, 750);
      assert.equal(h.messages.at(-1).variant, 'destructive');
    });
  }
}

test('late permission resolution cannot restart old tracking or stop a newer scan', async () => {
  const h = scannerHarness();
  const first = h.manager.startScanning();
  const oldReader = h.readers[0];
  h.manager.stopScanning();
  const second = h.manager.startScanning();
  h.readers[1].permission.resolve();
  await first;
  await flush();
  oldReader.permission.resolve();
  await flush();
  assert.equal(h.manager.getScanState().isScanning, true);
  assert.equal(h.timers.size, 2);
  h.readers[1].read();
  assert.equal((await second).success, true);
  assert.equal(h.readers[1].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('lookup trigger cancels before opening; retry resets the lookup panel', () => {
  const source = read('src/components/wallet/FindWalletFallback.tsx');
  assert.match(source, /onLookupStart\?\.\(\) === false\) return;\s*setOpen\(true\)/);
  assert.match(posSource, /key=\{lookupKey\} onSelect=\{handleLookupSelect\} onLookupStart=\{cancelSaleScan\}/);
  assert.match(posSource, /onClick=\{retrySaleScan\}/);
});

if (availableNames.includes('payRoundPlayer')) {
  test('round lookup invalidates in-flight NFC wallet fetch and double confirmation takes one entry', async () => {
    const h = posHarness();
    const response = deferred();
    h.responses.push(response);
    const scan = h.handlers.scanPlayerForRound();
    h.scanner.readers[0].read();
    await flush();
    h.handlers.cancelRoundScan();
    h.scanner.advance(31000);
    response.resolve({ data: wallet, error: null });
    await scan;
    assert.equal(h.calls.length, 0);
    const first = h.handlers.handleRoundLookupSelect({ wallet_id: wallet.id, attendee_name: 'Test' });
    const second = h.handlers.handleRoundLookupSelect({ wallet_id: wallet.id, attendee_name: 'Test' });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, 'pay_game_round');
    assert.equal(h.calls[0].args.p_via_phone_lookup, true);
    h.payment.resolve({ data: { ...h.context.activeRound, players_paid: 2, new_coin_balance: 1250 }, error: null });
    await Promise.all([first, second]);
    assert.equal(h.context.activeRound.players_paid, 2);
  });
}
