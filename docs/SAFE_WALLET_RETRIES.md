# Safe wallet retries

## What changed

`execute_wallet_operation(operation_id, request)` handles ordinary POS spending
and manual top-ups. A protected operation ledger stores the operator, exact
request and final result. Concurrent calls for one ID wait on the same row.
Successful replies contain the original transaction and balance after it, not a
fresh balance. Business rejections are final receipts too; unexpected errors roll
back the entire operation and can be retried under the same ID.

The request contains a wallet UUID and item/package/payment data, not attendee
names, phone numbers, email addresses or NFC serials. Browser session storage is
scoped to the signed-in operator. An uncertain request blocks new ordinary sales
and top-ups until Check / Retry safely resolves it. No mutation is sent if the
operation cannot first be saved. A timeout is not proof of failure.

Manual receipt references are unique after trimming surrounding whitespace,
uppercasing and removing the trailing `via:phone-lookup` audit marker. Punctuation
is retained. Cash payments require a unique receipt number per collection.
The transaction trigger protects the older `credit_wallet_coins` RPC as well.
Historical duplicate manual receipts are retained unchanged and reserved once.

Round rules, gateway checkout and payment verification are unchanged. Ordinary
POS fixed-item price validation remains separate work. The original spending RPC
does not have retry IDs: all venue terminals must load the new frontend.

## Verification commands

```sh
npm run test:wallet-retries
npm run test:live-sales
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
npm run build
```

PGlite runs the actual migration and existing spend/credit SQL against synthetic
tables. The React hook tests use simulated network I/O. The independent-session
test uses a disposable real PostgreSQL 17 server, not production:

```sh
# Install the optional test runtime outside the repository; approve its reviewed
# native symlink postinstall if your npm configuration requires that.
npm install --prefix /tmp/pinkd-retry-postgres-runtime embedded-postgres@17.9.0-beta.17
PINKD_EMBEDDED_POSTGRES_ROOT=/tmp/pinkd-retry-postgres-runtime \
  node --test scripts/test-wallet-retry-concurrency.mjs
```

That test verifies concurrent retries wait, one committed charge is returned to
all callers, a rolled-back first request permits one retry, and concurrent
distinct operations using the same top-up receipt produce only one credit.
It does not replace a complete Supabase schema replay or physical Android tests.

The browser test launches an isolated Chrome context on localhost only. All
Supabase calls are intercepted with synthetic responses, so no real payment or
customer data is involved:

```sh
PINKD_PLAYWRIGHT_ROOT=/path/to/node_modules node scripts/test-wallet-retry-browser.mjs
```

Verified at 390px and 1440px: pending operations disable new payment controls,
network failure plus page reload retains the exact retry request, a successful
retry unlocks the screen and displays its receipt, and the Top Up screen sends
the frozen package/reference. These are mocked browser checks, not hosted
Supabase or physical NFC results.

## Current verification result

- Retry/NFC/React suite: 29 tests passed.
- Independent PostgreSQL concurrency suite: passed (four real connections).
- Existing Live Sales suite: 11 tests passed.
- Local mocked Chrome: 390px and 1440px passed, including cross-route blocking.
- Lint, application/server TypeScript, production build and diff whitespace checks passed.
- Existing large-bundle and outdated Browserslist build warnings remain.
- Source publication to GitHub main is authorized; production changes are not.
- Hosted preview is deferred until an approved Pink'D staging Supabase project
  is identified and receives the migration. No hosted end-to-end or Android
  hardware test is claimed by these results.

## Release gates

- Full-UID changes are already on main in `11d3262`; the original worktree is untouched.
- Retry additions were prepared on `codex/safe-wallet-retries` and brought into
  a clean `codex/release-wallet-retries` worktree on top of `11d3262` for a separate
  source-only release commit. Existing working directories remain untouched.
- Main pushes trigger automatic Vercel builds. Production builds first run
  `scripts/check-wallet-backend.mjs`; a missing retry RPC blocks the build and
  leaves the previous production deployment serving traffic. After deploying and
  validating the migration, redeploy the failed commit or push a new commit.
- The gate uses an anonymous null-input permission probe, never an operator or
  service-role key. It checks RPC presence/protection, not full end-to-end behavior.
  Preview builds skip the production gate; do not manually promote an unvalidated
  preview. Staging and physical NFC validation remain release requirements.
- No production migration or Edge Function deployment is authorized here.
- Apply the new migration to an approved isolated Supabase stack before testing
  the hosted frontend's new RPC. A frontend-only preview against the unchanged
  production database cannot complete retry-protected payments.
- Test with separate staff/admin accounts, three physical Android-readable bands,
  slow connectivity, full-page refresh and scan-to-lookup takeover.
- If a tab is closed or its storage cleared before an unknown result is resolved,
  stop and reconcile the ledger with an admin. Do not create a replacement charge.
- Use one operator login per terminal. Session storage does not coordinate
  independently started payments on different phones or tabs.
- On production approval: compatibility audit, migration first, frontend second,
  reload terminals, and a controlled canary. Never fall back silently to the old
  non-idempotent spending RPC if the new one is missing.

## Operator recovery

Do not manually erase an unknown operation from browser storage. An administrator
can inspect its UUID in `wallet_operations` through a privileged database session
and match the returned transaction. Permission revocation deliberately prevents
replay until access is restored; it must not cause a new operation ID. New tables
are RLS-enabled and inaccessible to direct anonymous/authenticated table queries.
