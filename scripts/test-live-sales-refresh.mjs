import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Query's browser scheduling is tested without a real database or network.
const documentEvents = new EventTarget();
documentEvents.visibilityState = 'visible';
const windowEvents = new EventTarget();
windowEvents.setTimeout = (...args) => globalThis.setTimeout(...args);
windowEvents.clearTimeout = (...args) => globalThis.clearTimeout(...args);
globalThis.window = windowEvents;
globalThis.document = documentEvents;
const React = await import('react');
const { default: TestRenderer, act } = await import('react-test-renderer');
const require = createRequire(import.meta.url);
const { QueryClient, QueryClientProvider, focusManager } = require('@tanstack/react-query');
const sample = (sold = 1) => ({
  generated_at: new Date().toISOString(),
  sessions: [1, 2, 3, 4].map((session_number) => ({ session_number, label: `Session ${session_number}`, sold, on_hold: 0, capacity: 120, available: 120 - sold })),
  party: { sold, on_hold: 0 },
  totals: { intensive_admissions: sold * 4, party_admissions: sold, total_admissions: sold * 5, paid_orders: sold, event_revenue_inr: sold * 5500 },
  warnings: { session_assignment_items: 0, unknown_package_items: 0, pax_items: 0, incomplete_session_catalog: false },
});
const compile = (file, mockedRequire = require) => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { require: mockedRequire, module, exports: module.exports, document: documentEvents, window: windowEvents, AbortController });
  return module.exports;
};
const model = compile('src/lib/eventLiveSales.ts');

test('live refresh is visible-only, replaces counts, retains stale data, and cancels on unmount', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  const calls = [];
  let answer = { data: sample(), error: null };
  let hang = false;
  const supabase = { rpc(name) {
    assert.equal(name, 'get_event_live_sales');
    return { abortSignal(signal) {
      calls.push(signal);
      if (!hang) return Promise.resolve(answer);
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'aborted' } }), { once: true }));
    } };
  } };
  const { useLiveEventSales } = compile('src/hooks/use-live-event-sales.ts', (name) => {
    if (name === '@/integrations/supabase/client') return { supabase };
    if (name === '@/lib/eventLiveSales') return model;
    return require(name);
  });
  let current;
  function Harness({ enabled = true }) {
    current = { ...useLiveEventSales('admin-user', enabled) };
    return null;
  }
  const client = new QueryClient();
  let renderer;
  const flush = async () => {
    for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); t.mock.timers.tick(0); });
  };
  const tick = async (ms) => { await act(async () => t.mock.timers.tick(ms)); await flush(); };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(QueryClientProvider, { client }, React.createElement(Harness))); });
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(current.data.totals.total_admissions, 5);
    await tick(14999);
    assert.equal(calls.length, 1);
    answer = { data: sample(2), error: null };
    await tick(1);
    assert.equal(calls.length, 2);
    assert.equal(current.data.totals.total_admissions, 10);

    await act(async () => { documentEvents.visibilityState = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange')); });
    await tick(45000);
    assert.equal(calls.length, 2, 'hidden tabs must not poll');
    answer = { data: sample(0), error: null };
    await act(async () => { documentEvents.visibilityState = 'visible'; documentEvents.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    assert.equal(calls.length, 3);
    assert.equal(current.data.totals.total_admissions, 0, 'refunds/expiry can reduce counts; no ratchet');

    answer = { data: null, error: { message: 'network unavailable' } };
    await act(async () => { await current.refetch(); });
    await flush();
    assert.equal(current.isError, true);
    assert.equal(current.data.totals.total_admissions, 0, 'keep last successful snapshot on failure');

    answer = { data: {}, error: null };
    await act(async () => { await current.refetch(); });
    await flush();
    assert.equal(current.isError, true);
    assert.match(current.error.message, /incomplete or inconsistent/);

    answer = { data: sample(3), error: null };
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await flush();
    assert.equal(current.data.totals.total_admissions, 15);
    assert.equal(current.isError, false);

    hang = true;
    let pending;
    await act(async () => { pending = current.refetch(); });
    await tick(12000);
    await pending;
    await flush();
    assert.equal(current.isError, true, 'a hung request must time out visibly');
    assert.equal(current.data.totals.total_admissions, 15);

    await act(async () => { void current.refetch(); });
    const activeSignal = calls.at(-1);
    await act(async () => renderer.unmount());
    assert.equal(activeSignal.aborted, true);
    const finalCount = calls.length;
    await tick(45000);
    assert.equal(calls.length, finalCount, 'unmounted dashboard tab must not poll');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    client.clear();
    focusManager.setFocused(undefined);
    t.mock.timers.reset();
  }
});
