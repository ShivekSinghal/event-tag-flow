# Activity and account-recovery fix

Scope: the two findings selected from the 8 September audit. No cash-coin top-up rollout, payment/webhook changes, attendee ownership redesign, or broad role changes are bundled here.

Status on 9 September: implemented in `codex/event-readiness-fixes`, not deployed. Production approval was requested; no response received during implementation. The production migration, email function/configuration and real recovery-email test remain pending.

Verification: 24 activity/Auth-email test executions and 39 POS/NFC/award/retry regressions passed (some shared fixtures repeat). Lint, app TypeScript, email-handler TypeScript and build passed. Mocked activity browser checks passed at 390px and 1440px, including 30-second lookup takeover, late NFC, duplicate confirmation and lost-response recovery. Auth configuration dry run made no changes and confirmed the old URL, disabled hook and two-email hourly limit are still live. The first browser run hit an older process on occupied port 8096; the rerun used the confirmed new server at port 8110 and passed.

## Included

- Existing isolated activity implementation rebased onto main `d7900bf`, retaining the fixed scrollable staff dialog.
- Busk for a Cause and activity groups, 150-coin minimum donations with original numeric input validated server-side, fixed-price validation, free games with no scan/payment/award action.
- Existing retry-safe spending, confirmed manual lookup and NFC cancellation retained.
- Secured `send-auth-email`: Standard Webhooks signature/timestamp verification, trusted production destinations, no token logging, proper provider failures, retry idempotency, Pink'D account emails.
- Password recovery and invitations use Supabase's verify endpoint and the existing `/reset-password` route, not a missing `/auth/confirm` route.
- Auth configuration helper preserves unrelated settings; corrects Site URL, adds exact reset/login redirects, enables the verified hook and reduces email-token expiry to one hour.
- The current Auth email limit is two per hour. The helper raises it to at least 60/hour for volunteer recovery, preserving a higher existing limit and the per-user cooldown. [Supabase rate-limit documentation](https://supabase.com/docs/guides/auth/rate-limits).

## Verification commands

```sh
node --test scripts/test-auth-email.mjs scripts/test-activities.mjs
node --test scripts/test-pos-controls.mjs scripts/pos-scan.test.mjs scripts/test-wallet-retry-client.mjs scripts/test-award-client.mjs
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit --skipLibCheck --target ES2022 --module ESNext --lib ES2022,DOM,DOM.Iterable supabase/functions/send-auth-email/handler.ts
npm run build
```

Run `scripts/test-activities-browser.mjs` against the isolated local server with `PINKD_PLAYWRIGHT_ROOT` and `PINKD_TEST_URL`. It mocks all backend traffic and does not certify physical Android NFC.

## Approved live release order

1. Confirm production approval and record the current frontend rollback deployment. Do not merge unrelated staged branches.
2. Inspect current games and staff configuration. Apply only `20260908131049_activity_groups_and_donations.sql`; reconcile its actual recorded migration timestamp. Do not blanket-repair old migration history or deploy unrelated SQL.
3. Verify 15 canonical active games and the numeric spending signature. Anonymous callers must remain denied. Do not charge a real wallet merely to test the migration.
4. Release the frontend and have stall phones refresh. Older donation requests without a game ID will intentionally fail rather than charge/report against an unidentified activity.
5. Deploy only `send-auth-email` plus `handler.ts`, with JWT verification disabled because the handler verifies the Auth hook signature. Existing `RESEND_API_KEY` and a verified `AUTH_EMAIL_FROM` or `EVENT_CONFIRMATION_EMAIL_FROM` are required. Do not expose those values or enable the old insecure handler.
6. Run `scripts/configure-auth-email.mjs` read-only first. After approval, run with `--apply --approved-project xdaienqjbybomctsoiro`, providing the management token only through a protected environment. The script creates a random shared signing secret, refuses to rotate an already-active hook, probes unsigned-request rejection, then enables Auth email.
7. Send one authorized recovery email, verify provider delivery and the production reset link, and let the recipient complete the password change. Do not reset any volunteer password without their involvement.
8. Review the activity assignment script separately before applying it. It grants only the previously agreed game assignments and preserves unrelated permissions; this release does not silently promote staff to cash-manager/admin.

## Still pending outside this patch

- Production promotion/configuration until approved, and real password-reset delivery/completion.
- Android NFC/lookup race rehearsal and venue network testing.
- Counter-manager and remaining staff assignments, test-band blocking after rehearsal.
- Dedicated cash coin top-ups, prominent POS acknowledgement, enhanced Check Balance and timed void release.
- Attendee ownership protection, cancelled/emailed order reconciliation, partial-fulfilment webhook recovery and legacy-domain 301.

## Recovery

If the new Auth hook fails, inspect its HTTP result without logging token-bearing requests. Disabling the hook restores the prior default SMTP behavior, which is not adequate for volunteer email delivery. Do not present that fallback as a successful fix. No existing passwords, user roles, sessions or payment secrets are changed by the configuration script.

Do not downgrade the database automatically with a frontend rollback. Game metadata is additive; revert the specific reviewed function definitions only through a deliberate database recovery procedure.
