import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import ts from 'typescript';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = readFileSync(new URL('../src/data/gameRules.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { gameRules } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const manifest = JSON.parse(readFileSync(new URL('../public/game-rules/manifest.json', import.meta.url), 'utf8'));
const base = process.env.GAME_RULES_URL || 'http://127.0.0.1:8091';
const output = process.env.GAME_RULES_SCREENSHOTS || '/tmp/pinkd-copy-qa';
mkdirSync(output, { recursive: true });
const normalize = text => text.replace(/\s+/g, ' ').trim();
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const game of gameRules) {
      const { routeId } = manifest.games.find(entry => entry.id === game.id);
      const response = await page.goto(`${base}/games-rules/${routeId}`, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200);
      await page.locator('.rules-instructions').waitFor();
      assert.equal(await page.locator('h1').innerText(), `${game.name}.`);
      const displayed = normalize(await page.locator('.rules-instructions').innerText());
      for (const rule of game.rules) {
        assert.ok(displayed.includes(normalize(rule.title)), `${game.id}: missing heading`);
        assert.ok(displayed.includes(normalize(rule.body)), `${game.id}: missing body`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${game.id}: horizontal overflow at ${width}`);
      assert.equal(await page.locator('.rules-pdf-download').getAttribute('href'), `/game-rules/${routeId}.pdf`);
      if (['wing-person-for-hire', 'beer-pong'].includes(game.id)) await page.screenshot({ path: `${output}/${routeId}-${width}.png`, fullPage: true });
    }
  }
  await page.goto(`${base}/game-rules`);
  await page.locator('.rules-game').first().waitFor();
  assert.equal(await page.locator('.rules-game').count(), 15);
  await page.getByRole('searchbox', { name: 'Search games' }).fill('Jamaal');
  assert.equal(await page.locator('.rules-game').count(), 1);
  assert.equal(await page.locator('.rules-game h2').innerText(), 'Jamal Challenge');
  for (const entry of manifest.games) {
    const response = await page.request.get(`${base}/game-rules/${entry.routeId}.pdf`);
    assert.equal(response.status(), 200);
    const bytes = await response.body();
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.pdfSha256, `${entry.routeId}: stale PDF`);
  }
  const allRules = await page.request.get(`${base}/PINKD-Game-Rules.pdf`);
  assert.equal(allRules.status(), 200);
  const combined = JSON.parse(readFileSync(new URL('../public/game-rules-pdf-manifest.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(await allRules.body()).digest('hex'), combined.pdfSha256);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, gamePages: 15, viewports: [375, 1440], pdfs: 16, runtimeErrors: errors, base }));
} finally {
  await browser.close();
}
