// npm dependencies: typescript, qrcode, playwright (or PLAYWRIGHT_MODULE).
// BROWSER_CHANNEL=chrome uses installed Chrome. Python is only required for --docx.
// Example: node scripts/generate-individual-game-assets.mjs --python /path/to/python --docx /path/to/QR-Codes.docx
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import QRCode from 'qrcode';
import { generateRulePdfs } from './game-rules-pdf.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const option = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const hash = (content) => createHash('sha256').update(content).digest('hex');
async function load(relative) {
  const source = readFileSync(join(root, relative), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
  return { source, module: await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`) };
}
const rules = await load('src/data/gameRules.ts');
const routes = await load('src/data/gameRuleRoutes.ts');
const games = rules.module.gameRules.map(game => {
  const routeId = routes.module.gameRuleRouteIds[game.id];
  if (!routeId) throw new Error(`Missing permanent route for ${game.id}`);
  return { ...game, routeId, url: `https://pinkd.hashtag.dance/games-rules/${routeId}` };
});
const publicDir = join(root, 'public/game-rules');
mkdirSync(publicDir, { recursive: true });
for (const game of games) {
  await QRCode.toFile(join(publicDir, `${game.routeId}.png`), game.url, {
    width: 900, margin: 4, errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  });
}
const temp = mkdtempSync(join(tmpdir(), 'pinkd-rules-assets-'));
try {
  const data = join(temp, 'games.json');
  writeFileSync(data, JSON.stringify(games));
  await generateRulePdfs(games, publicDir);
  const docx = option('--docx');
  if (docx) {
    mkdirSync(dirname(docx), { recursive: true });
    const args = [join(root, 'scripts/generate-individual-game-assets.py'), data, publicDir, '--docx', docx, '--docx-only'];
    const result = spawnSync(option('--python') ?? 'python3', args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Game document generation failed');
  }
  const manifest = {
    sourceSha256: hash(rules.source), routesSha256: hash(routes.source),
    games: games.map(game => ({
      id: game.id, routeId: game.routeId, url: game.url,
      pdfSha256: hash(readFileSync(join(publicDir, `${game.routeId}.pdf`))),
      qrSha256: hash(readFileSync(join(publicDir, `${game.routeId}.png`))),
    })),
  };
  writeFileSync(join(publicDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(publicDir, '../game-rules-pdf-manifest.json'), `${JSON.stringify({sourceSha256: hash(rules.source), pdfSha256: hash(readFileSync(join(publicDir, '../PINKD-Game-Rules.pdf'))), games: games.length})}\n`);
  console.log(`Generated ${games.length} game PDFs and QR codes${docx ? ' plus the Word document' : ''}.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
