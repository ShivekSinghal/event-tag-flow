# Cash counter release

## Source and scope

Based on main `884076d`. Manas's original cash patch is retained as commit
`45ffa41`; the following corrective commit replaces unsafe parts before release.
Cash is independent of the direct-award release. Main auto-deployment remains on.
No production database, secret, frontend or GitHub main update has been made by
this implementation pass.

Public cash checkout is atomic and uses the existing pricing/capacity lock. Its
persisted operation UUID and token recover the same order. Cash accepts event
packages only. The collecting studio is separate from the customer's home studio.
Manager/studio assignments are managed by admins inside Cash Desk and enforced
by the database, not by counter mode. Existing issue-band permissions are unchanged.

Cash Desk mutations are server-only, authenticated through the Edge Function,
transactional and replay-safe. Holds last five minutes; the first code request
extends once to ten minutes. Three resends invalidate old codes but never extend
that deadline. Each issued code permits three failed attempts. Revival is limited
to 45 minutes and rechecks aggregate session seats and current party pricing.

Email jobs have exclusive claims and stable Resend idempotency keys. A payment
stays paid on delivery failure. Use Cash Desk's Retry notifications action; this
release does not add a background email worker. An uncertain request older than
23 hours requires provider review instead of automatic resending. `sent` means
accepted by Resend, not independently proven inbox delivery.

## Required configuration

- Existing Supabase URL, anon and service-role function secrets.
- `RESEND_API_KEY` and a verified `EVENT_CONFIRMATION_EMAIL_FROM` sender.
- New `CASH_BOOKING_CODE_SECRET`: securely generated random secret, at least 32
  characters. Keep stable while codes remain live; never put it in Vite variables.
- Alert recipients are explicitly `manas210890@gmail.com` and
  `ayushi.pathania@gmail.com`. No default recipient inference is used.
- Obtain Wing names, login emails and collecting-studio assignments before
  provisioning actual `studio_manager` accounts.

## Local verification

Executed: lint, app/node TypeScript, production build, Deno checks for cash-booking
and changed gateway functions; existing POS/UID/retry/void suites; real independent
PostgreSQL-connection cash race tests; React hook refresh/retry tests; mocked
Cash Desk admin/manager/staff browser sessions; mobile/desktop QR and coin-checkout
browser regressions. Browser APIs and NFC were simulated, not production payments
or physical hardware. The focused PostgreSQL fixture runs existing checkout
functions plus this migration, NOT the entire Supabase migration history.

Commands (runtime paths are supplied externally):

```sh
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
npm run build
npm run test:pos-controls
node --test scripts/test-cash-client.mjs
PINKD_EMBEDDED_POSTGRES_ROOT=/path/to/runtime node --test scripts/test-cash-concurrency.mjs
PINKD_PLAYWRIGHT_ROOT=/path/to/node_modules PINKD_TEST_URL=http://127.0.0.1:8095 node scripts/test-cash-browser.mjs
```

## Remaining release gates and deployment order

1. Identify a dedicated Pink'D test Supabase project. Do not reuse an unrelated
   application's staging database. Replay the complete migration history there;
   regenerate/check Supabase types against that resulting schema.
2. Deploy the cash migration and Edge Function to that isolated stack. Verify
   JWT/RLS with separate real admin, assigned manager, other-studio manager and
   staff sessions, and check token recovery and gateway rejection of cash orders.
3. Create a protected Vercel preview against that stack. Test real code delivery,
   resend failure, confirmation and reconciliation alert delivery, refresh after
   a lost response, checkout counter-mode persistence/reset and online checkout.
4. Complete the physical Android scan-to-lookup rehearsal. Desktop simulations
   are not a substitute. Confirm new managers' studio assignments.
5. Review a production migration dry run from a clean worktree; apply ONLY
   `20260907192000_cash_bookings.sql`, not the excluded performance migration.
   Deploy `cash-booking`, `event-payment-create`, and `event-payment-verify`, plus
   any shared-email consumers selected by the reviewed function deployment.
6. Verify readiness RPC `cash_backend_version` returns 1 and cash-booking GET
   returns ready=true. The production prebuild gate checks both before shipping.
7. Recheck remote main, merge cash only, verify automatic Vercel deployment and
   reload staff terminals. Retain the previous production deployment for rollback.

Do not merge before these gates: main's auto-deployment is intentionally enabled.
No deadline overrides a capacity, authorization or payment-integrity failure.
