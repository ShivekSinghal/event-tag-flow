# Dare Board

Local route: `/dare-board`, under Progress alongside Donation Progress. Admin access only.

## Metric

This release uses **coins spent**, not rupees raised. Active packs include bonus coins (for example INR 5,000 buys 6,000 coins), so a coin cannot be relabelled as an INR of revenue.

Counts negative `coin_amount` transactions for food, drinks (Bar), games whose transaction category is `tier_1`, and the explicitly opted-in Karaoke and Busk for a Cause games. Legacy game sales with a null or generic `games` category fall back to the game catalog's current activity group. Explicit historical categories take priority for ordinary games. Karaoke and Busk remain donation-priced in POS; their durable `games.contributes_to_dare_board` flag includes past and future spends even after a catalog rename. They have a separate `performance_coins` subtotal and `performances` log source, not a Tier 1 label. Voided sales with a linked refund are excluded. Top-ups, coin purchases, other tiers, free games and all other donation-game spends are excluded. Only first names and studios are returned for guest identification; no phone numbers, emails, full names, wallet balances or NFC IDs. This is a cumulative event ledger total, not a daily total.

The admin-only aggregate RPC runs over the whole ledger without REST row limits. It is read-only and does not alter payments, wallet balances or game rules. The browser polls every 10 seconds while visible, with an 8-second request timeout; errors retain the last confirmed total and block manual replays until refreshed.

## Checkpoints

10,000; 25,000; 50,000; 75,000; 1,00,000; 1,50,000; 2,00,000; 3,00,000; 4,00,000; 5,00,000; 10,00,000.

New crossings queue cue-card animations in order. Previously reached milestones do not auto-play on page load. Unlocked checkpoints can be reopened. Refunds reduce the displayed total and relock checkpoints; a refund/re-purchase bounce does not auto-celebrate the same milestone again within the mounted view. Celebration state is presentation-only, not a durable event/award ledger. The host currently draws a physical dare card: "Pick a card. Give the dare." No dare list has been invented.

Each checkpoint identifies the transaction whose cumulative net coin total first reaches or exceeds that milestone. Calculated over the entire qualifying history on the server, not the latest transaction visible to a browser poll. Ordering is recorded `created_at`, then transaction UUID to resolve equal timestamps deterministically (not an assertion of exact commit ordering for concurrent sales). One payment can cross several checkpoints and selects the same card picker for all of them.

The unlock screen names the card picker, studio, activity, coins and transaction time. The board retains the latest checkpoint's picker and shows the three latest contributions. A full contribution log opens over the board with 20-row cursor pagination; it retains voided sales marked "Voided". Totals and milestone attribution always use the entire history, including when the log is on an older page. This is a read-only reconstruction, not a frozen award record: voiding an earlier sale can change which payment qualifies as a checkpoint's picker. Missing names display "Guest" for host verification.

Fullscreen projects only the board, excluding dashboard navigation. Reduced-motion preferences disable animations. Names are limited to first names plus studio; no contact or band data is projected.

## Verification / Release

- Karaoke/Busk rollout: the compatible frontend shipped first (missing `performance_coins` defaults to zero), then `20260911203638_dare_board_karaoke_busk.sql` was applied to production. Refresh any already-open projector tab to load the new response schema. Only these two game flags and the read-only report change; no wallet, price or transaction updates. A later catalog deletion/recreation must explicitly opt the replacement game in.
- Production verified at 2026-09-11 20:37 UTC: 3,650 performance coins included; total 97,540 coins, 110 counted sales. Both activity flags enabled; prices and donation category unchanged. Read-only admin-role query, not an authenticated browser or physical payment test. Totals continue changing with live sales.
- Karaoke/Busk verification: 5 database/schema/metric tests, 41 existing POS/retry/void/QR tests, lint, both TypeScript projects, build, and browser checks at 1920x1080, 1366x768 and 390x844 passed. Browser payment fixtures are simulated; no real transactions were created for testing.

- `node --test scripts/test-dare-board.mjs`: actual PGlite/Postgres tests including voids, role checks, over 1,000 transactions, cursor pagination, multiple crossings, exact boundaries, timestamp ties, identity minimization, and the distinction between last payer and checkpoint picker.
- `PINKD_PLAYWRIGHT_ROOT=... PINKD_TEST_URL=http://127.0.0.1:8092 node scripts/test-dare-board-browser.mjs`: isolated browser mocks, not production financial activity.
- The reviewed `20260911151309_dare_board_progress.sql` migration was applied to production before this frontend release. It grants authenticated execution but checks the caller's current admin profile internally; anonymous execution is revoked. The file version matches the production migration history.
- The host draws physical dare cards; no dare list is configured. A real projector rehearsal remains an on-site check. The release includes this read-only report, not any change to payments or balances.
- Previous frontend deployment retained for rollback: `dpl_F8WUESEWiLDAJpHLdmpGj2fRmHmB` (`event-tag-flow-nyp47bq8o-shiveks-projects.vercel.app`).

## Artwork

`public/dare-board-background.png` was generated with the built-in image tool. Prompt: wide black cue-card background, hot pink #ff007f and cyan diagonal laser/foil streaks at the edges, star-shaped glints, central 70 percent clear for readable scoreboard text; no text, logo, people, cards, UI, or bokeh/orbs. Brand logo reuses `/media/pinkd-logo.png`.
