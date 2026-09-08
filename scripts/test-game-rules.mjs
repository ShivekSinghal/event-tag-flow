import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/data/gameRules.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { gameRules, gameRuleGroups } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('all 15 canonical activities have unique ids and complete rules', () => {
  assert.equal(gameRules.length, 15);
  assert.equal(new Set(gameRules.map(game => game.id)).size, 15);
  for (const game of gameRules) {
    assert.ok(gameRuleGroups.includes(game.group));
    assert.ok(game.name && game.cost && game.outcome && game.rules.length >= 4);
  }
  assert.deepEqual(Object.fromEntries(gameRuleGroups.slice(1).map(group => [group, gameRules.filter(game => game.group === group).length])), {
    'Tier 1': 3, 'Tier 2': 3, 'Tier 3': 3, Free: 4, Donations: 2,
  });
});

test('rewards and fees do not promise Pinkredibles for free or donation activities', () => {
  for (const game of gameRules) {
    if (game.group === 'Free') assert.equal(game.cost, 'Free');
    if (['Free', 'Donations', 'Tier 1'].includes(game.group)) assert.equal(game.prize, undefined);
    if (['Tier 2', 'Tier 3'].includes(game.group)) assert.match(game.prize, /1 Pinkredible/);
    if (game.group === 'Donations') assert.match(game.cost, /150\+/);
  }
});

test('latest Minute to Win It sequence supersedes the original SOP', () => {
  const game = gameRules.find(game => game.id === 'minute-to-win-it');
  assert.match(game.rules[1], /7 or more/);
  assert.match(game.note, /roll dice, 7 ball taps, stack 7 cups, drink, flip the cup/);
  assert.match(game.outcome, /before the timer expires/);
});

test('route is public and linked from the landing footer', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<Route path="\/game-rules" element={<GameRules \/>} \/>/);
  assert.ok(app.indexOf('path="/game-rules"') < app.indexOf('<ProtectedRoute'));
  assert.match(readFileSync(new URL('../src/pages/EventLanding.tsx', import.meta.url), 'utf8'), /<Link to="\/game-rules">Game Rules<\/Link>/);
});
