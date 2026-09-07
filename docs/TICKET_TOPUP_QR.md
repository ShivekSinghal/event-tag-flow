# Patch 3: ticket-specific coin top-up QR

## Scope

Frontend-only changes on `codex/ticket-topup-qr`, based on `main` at `76b4754`.
No database migration, Edge Function, payment provider configuration, NFC UID format,
round entry rule or manual payment RPC changes.

- Top Up shows a generic coin-shop QR until a band is selected. After NFC scanning
  or confirmed staff lookup, it checks the active wallet and its paid party ticket.
- Eligible bands get `https://pinkd.hashtag.dance/coins?ref=XXXXXXXX&band=<wallet UUID>`.
  The reference uses the existing eight-character order proof. No phone, email or
  full NFC UID is included. Treat the link as private ticket information.
- Personal QR images are generated locally using lazy-loaded `qrcode`. No external
  QR service receives the ticket reference. The generic PNG is embedded in the build.
- Old QR requests are cancelled/ignored when switching bands. Unlinked, inactive,
  unavailable or ineligible tickets do not get a personal payment link.
- POS insufficient-balance messages use the attempted wallet, including a definitive
  server rejection returned from safe retry. Starting another scan/lookup dismisses
  the previous rejection without clearing pending operations or successful receipts.
- `/coins` preselects only a band returned by the existing ticket lookup and requires
  explicit confirmation for a band-specific link. An invalid band hint never silently
  selects somebody else. The existing checkout RPC revalidates band ownership/status.
- Counter payment remains below the QR. Do not manually credit an online payment.
  Online checkout, webhook crediting and payment polling remain unchanged.

## Automated verification

Run from this worktree:

```sh
npm run test:ticket-topup
npm run test:pos-controls
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
npm run build
```

Browser suites require a local dev server and Playwright with Chrome available:

```sh
PINKD_PLAYWRIGHT_ROOT=<node_modules containing playwright> PINKD_TEST_URL=http://127.0.0.1:8094 node scripts/test-ticket-topup-browser.mjs
PINKD_PLAYWRIGHT_ROOT=<node_modules containing playwright> PINKD_TEST_URL=http://127.0.0.1:8094 node scripts/test-wallet-retry-browser.mjs
```

Browser coverage uses 390px and 1440px widths. All non-local API/payment traffic is
mocked or blocked: generic/personal QR rendering, scan and confirmed lookup, stale
responses, unlinked tickets, POS insufficient balance after retry, crew confirmation,
foreign band hints, correct target-wallet payload, paid/failed responses, persistent
receipts, safe retry, admin void and manual counter credit. These tests do not prove
real gateway, webhook delivery or physical NFC behavior.

## Before production promotion

1. Open a protected preview. Scan a real Android NFC band, then scan its QR from a
   second phone camera; confirm the intended guest/band is selected.
2. Repeat for two attendees on a crew ticket and verify each targets the right band.
3. Complete an authorized online canary payment; independently verify one webhook
   coin credit, one ledger movement, and refreshed wallet balance. Do not also use
   the counter credit control for that payment.
4. Test cancelled/failed checkout: no coin credit. Test duplicate callback/webhook:
   no duplicate credit. Existing backend behavior is reused, not changed here.
5. Reissue/block a band after creating its QR and ensure checkout refuses the old
   target. Test restricted staff sessions on POS separately from the admin account.
6. Verify manual cash/card receipts and scan-to-lookup cancellation on real devices.

The owner subsequently authorized pushing and deploying this patch. Physical Android
and real-payment canary checks above remain outstanding; automated mocked tests do not
replace them. This release makes no database or Edge Function changes. The existing dependency
audit reports 26 vulnerabilities (including one critical); none of the reported
nodes are dependencies newly introduced by this patch. No existing dependency version
was changed. Build still reports the existing large bundle/outdated Browserslist warnings.
