// Chromium preserves the supplied Unicode punctuation and emoji in printable rules.
import { join } from 'node:path';

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const general = [
  'Play fair. The runner explains the format and decides disputes. No interference; respect consent. Alcohol is always optional, with a non-alcoholic alternative.',
  'Paid play starts after the runner confirms your coin payment. Once a game starts, its entry fee is non-refundable. Free games need no coin payment or NFC scan.',
  'Confirm the fee and local format with the runner before paying. Donations start at 150 whole coins. Party entry is 18+.',
];

export async function generateRulePdfs(games, assets) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const section = game => `<section><p class="label">${escape(game.group)} | ${escape(game.cost)}</p><h1>${escape(game.name)}</h1><p>${escape(game.outcome)}</p>${game.prize ? `<p class="label">Prize: ${escape(game.prize)}</p>` : ''}<h2>HOW TO PLAY</h2><ol>${game.rules.map(rule => `<li>${typeof rule === 'string' ? escape(rule) : `<strong>${escape(rule.title)}</strong><p class="copy">${escape(rule.body)}</p>`}</li>`).join('')}</ol>${game.note ? `<p class="note">${escape(game.note)}</p>` : ''}<h2>BEFORE YOU PLAY</h2>${general.map(text => `<p class="note">${escape(text)}</p>`).join('')}${game.prize?.includes('Pinkredible') ? '<p class="note">Each Pinkredible gives Rs. 100 off course registration, not cash. Check your band on My coins.</p>' : ''}<p class="note"><a href="${escape(game.url)}">${escape(game.url)}</a></p></section>`;
  const html = content => `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>PINK'D Game Rules</title><style>
    *{box-sizing:border-box} body{margin:0;color:#161616;font:10pt/1.3 Arial,sans-serif;letter-spacing:0}
    h1{font-size:25pt;line-height:1.16;margin:8pt 0 10pt}h2,.label{color:#c60063;font-size:10pt;font-weight:700}
    h2{margin:12pt 0 7pt;break-after:avoid}.label{margin:0 0 8pt}p{margin:0 0 5pt}
    ol{margin:0;padding-left:18pt}li{padding-left:1pt;margin:0 0 8pt;break-inside:avoid}li strong{display:block;margin-bottom:3pt}
    .copy{white-space:pre-line;overflow-wrap:anywhere}.note{font-size:9pt;line-height:1.4;color:#454545}
    section+section{break-before:page}a{color:inherit;text-decoration:none}
  </style></head><body>${content}</body></html>`;
  try {
    const page = await browser.newPage();
    const print = async (content, path) => {
      await page.setContent(html(content), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({ path, format: 'A4', printBackground: true, displayHeaderFooter: true,
        margin: { top: '27mm', bottom: '20mm', left: '19mm', right: '19mm' },
        headerTemplate: '<div style="width:100%;background:#000;color:#fff;padding:6mm 19mm;font:700 14px Arial;-webkit-print-color-adjust:exact">PINK\'D <span style="float:right;color:#ff007f;font-size:10px">GAME RULES</span></div>',
        footerTemplate: '<div style="width:100%;padding:0 19mm;font:8px Arial;color:#555">pinkd.hashtag.dance/game-rules <span style="float:right" class="pageNumber"></span></div>',
      });
    };
    for (const game of games) await print(section(game), join(assets, `${game.routeId}.pdf`));
    await print(games.map(section).join(''), join(assets, '../PINKD-Game-Rules.pdf'));
  } finally {
    await browser.close();
  }
}
