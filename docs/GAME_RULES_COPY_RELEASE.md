# September 10 Game Copy

The supplied text is preserved in `game-rules-handoff-2026-09-10.txt`. All 15
activities use it in the shared rules data, public index, individual pages and
downloadable PDFs. Existing route IDs, printed QR codes, prices and donation
categories remain unchanged. Jamal Challenge remains searchable as Jamaal
Challenge; Minute to Minute retains its Minute to Win It alias.

This is a copy-only release. It does not configure POS awards, change game
assignments, change prices or modify the database. The new copy promises
Pinkredibles for Beer Pong, Squid Games and Jamal Challenge. Existing free-game
award support must be checked separately before staff rely on those promises.
The Cricket and Bombastic display prizes follow the supplied beer/shot wording;
their backend reward settings are not changed by this release.

## Regenerate Downloads

The generator requires TypeScript, qrcode and Playwright with Chromium. Set
`PLAYWRIGHT_MODULE` to a Playwright module path when it is not locally installed.
Set `BROWSER_CHANNEL=chrome` to use installed Chrome. Chromium preserves the
handoff's emoji and punctuation in the PDFs.

```sh
node scripts/generate-individual-game-assets.mjs
node --test scripts/test-game-rules.mjs
```

This refreshes all 15 individual PDFs, the complete PDF and their checksum
manifests. QR destinations remain unchanged. The optional `--docx` export also
requires Python with python-docx and reportlab, as before.

## Browser Verification

```sh
GAME_RULES_URL=http://127.0.0.1:8091 node scripts/test-game-rules-browser.mjs
```

The read-only browser check verifies every game at 375px and 1440px, all supplied
instruction text, alias search, no horizontal overflow, PDF links and runtime
errors. It does not submit payments, award prizes or alter production records.
