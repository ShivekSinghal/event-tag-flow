import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/eventPackages.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { EVENT_TIME_SLOTS, EVENT_PACKAGE_OPTIONS, BOOKABLE_EVENT_TIME_SLOTS, isBookableEventSlot,
  isPackageBookable, areBookingSlotsValid, getDefaultTimeSlots,
} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('hide Wednesday without renumbering historical session identities', () => {
  assert.equal(EVENT_TIME_SLOTS.length, 4);
  assert.deepEqual(BOOKABLE_EVENT_TIME_SLOTS, ['Thursday, Sept 10 @ 6:00 PM', 'Thursday, Sept 10 @ 8:00 PM']);
  assert.deepEqual(EVENT_TIME_SLOTS.map(isBookableEventSlot), [false, false, true, true]);
  assert.deepEqual(getDefaultTimeSlots(EVENT_PACKAGE_OPTIONS.find(p => p.id === 'four-intensives')), EVENT_TIME_SLOTS);
});

test('only 1/2 intensive passes and party entry remain bookable', () => {
  assert.deepEqual(EVENT_PACKAGE_OPTIONS.filter(isPackageBookable).map(p => p.id), ['one-intensive', 'two-intensives', 'party-entry']);
});

test('reject completed, duplicate, unknown and incorrect slot selections', () => {
  const one = EVENT_PACKAGE_OPTIONS.find(p => p.id === 'one-intensive');
  const two = EVENT_PACKAGE_OPTIONS.find(p => p.id === 'two-intensives');
  const party = EVENT_PACKAGE_OPTIONS.find(p => p.id === 'party-entry');
  for (const slot of [...EVENT_TIME_SLOTS.slice(0, 2), 'unknown']) assert.equal(areBookingSlotsValid(one, [slot]), false);
  assert.equal(areBookingSlotsValid(one, [EVENT_TIME_SLOTS[2]]), true);
  assert.equal(areBookingSlotsValid(two, [EVENT_TIME_SLOTS[2]]), false);
  assert.equal(areBookingSlotsValid(two, [EVENT_TIME_SLOTS[2], EVENT_TIME_SLOTS[2]]), false);
  assert.equal(areBookingSlotsValid(two, BOOKABLE_EVENT_TIME_SLOTS), true);
  assert.equal(areBookingSlotsValid(party, []), true);
  assert.equal(areBookingSlotsValid(party, BOOKABLE_EVENT_TIME_SLOTS), false);
  for (const option of EVENT_PACKAGE_OPTIONS.filter(p => p.intensiveCount === 4)) assert.equal(areBookingSlotsValid(option, EVENT_TIME_SLOTS), false);
});
