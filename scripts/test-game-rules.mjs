import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/data/gameRules.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { gameRules, gameRuleGroups } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('every game has a stable public route and matching individual PDF and QR', async () => {
  const routesSource = readFileSync(new URL('../src/data/gameRuleRoutes.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(routesSource, { compilerOptions: { module: ts.ModuleKind.ESNext } });
  const { gameRuleRouteIds, gameRulePath } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
  const manifest = JSON.parse(readFileSync(new URL('../public/game-rules/manifest.json', import.meta.url), 'utf8'));
  const hash = data => createHash('sha256').update(data).digest('hex');
  assert.equal(manifest.sourceSha256, hash(source), 'Regenerate individual game PDFs after editing rules');
  assert.equal(manifest.routesSha256, hash(routesSource));
  assert.equal(manifest.games.length, gameRules.length);
  assert.equal(new Set(Object.values(gameRuleRouteIds)).size, gameRules.length);
  assert.deepEqual(Object.keys(gameRuleRouteIds), gameRules.map(game => game.id));
  for (const game of gameRules) {
    const entry = manifest.games.find(item => item.id === game.id);
    assert.equal(entry.routeId, gameRuleRouteIds[game.id]);
    assert.equal(entry.url, `https://pinkd.hashtag.dance${gameRulePath(game.id)}`);
    const pdf = readFileSync(new URL(`../public/game-rules/${entry.routeId}.pdf`, import.meta.url));
    const qr = readFileSync(new URL(`../public/game-rules/${entry.routeId}.png`, import.meta.url));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(hash(pdf), entry.pdfSha256);
    assert.equal(hash(qr), entry.qrSha256);
  }
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/games-rules\/:gameId" element={<GameRulePage \/>}/);
  assert.ok(app.indexOf('path="/games-rules/:gameId"') < app.indexOf('<ProtectedRoute'));
});

test('complete PDF matches current rules and is independent of page filters', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/game-rules-pdf-manifest.json', import.meta.url), 'utf8'));
  const pdf = readFileSync(new URL('../public/PINKD-Game-Rules.pdf', import.meta.url));
  assert.equal(manifest.sourceSha256, createHash('sha256').update(source).digest('hex'), 'Regenerate the complete PDF after changing rules, then update its manifest');
  assert.equal(manifest.pdfSha256, createHash('sha256').update(pdf).digest('hex'));
  assert.equal(manifest.games, gameRules.length);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(readFileSync(new URL('../src/pages/GameRules.tsx', import.meta.url), 'utf8'), /href="\/PINKD-Game-Rules.pdf" download="PINKD-Game-Rules.pdf"/);
});

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
  assert.match(game.rules[1].body, /7 or more/);
  assert.match(game.rules[3].body, /dice total = your cup count/);
  assert.match(game.rules[8].body, /only the fastest person/);
  assert.equal(game.aliases, 'Minute to Win It');
  assert.equal(game.name, 'Minute to Minute');
});

test('new Bombastic and Hurdle mechanics replace the old SOP', () => {
  const bomb = gameRules.find(game => game.id === 'bombastic');
  assert.match(bomb.rules[0].body, /5 players. One line/);
  assert.match(bomb.rules[2].body, /repeats it and adds/);
  const hurdle = gameRules.find(game => game.id === 'hurdle');
  assert.match(hurdle.rules[3].body, /\+7 seconds/);
  assert.match(hurdle.rules[4].body, /lemon/);
  assert.match(hurdle.rules[6].body, /10 full seconds/);
});

test('route is public and linked from the landing footer', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /<Route path="\/game-rules" element={<GameRules \/>} \/>/);
  assert.ok(app.indexOf('path="/game-rules"') < app.indexOf('<ProtectedRoute'));
  assert.match(readFileSync(new URL('../src/pages/EventLanding.tsx', import.meta.url), 'utf8'), /<Link to="\/game-rules">Game Rules<\/Link>/);
});
