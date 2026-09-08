# Direct Pinkredible award release

## Source and preserved behavior

Manas's original patch is preserved as `3386b38`, based on main `884076d`.
Corrective work is a separate commit. Release cash independently first; this
feature does not depend on cash. The integration now retains both release
histories. Main automatic production deployment stays on. Neither feature's
database migration has been deployed in this pass.

Games use the existing retry-safe ordinary POS charge, including full UID scans,
lookup markers, top-up QR, persistent receipts and admin voids. Trophy selection
scans or explicitly looks up a winner, presents an eligible paid transaction,
then awards using a persisted operation UUID. Round tables and RPCs remain intact.

The database checks active prize games, explicit staff/manager assignments,
active bands, unused/unvoided paid entries, one award per entry and a cross-operator
two-minute same-band/game cooldown. Awards and voids lock the same original sale
first. Award-bearing entries cannot be voided. Matching retries return their
original receipt even after the cooldown. Changed requests and foreign operators
are rejected. Pending outcomes block competing sales, awards and void actions.

The patch's older ledger policies and coupon/redemption replacements were NOT
carried over. Existing restricted ledger access, minimal public coupon response,
service-role redemption, reissue behavior, INR 100 value and October 11 expiry
remain in force. No game pricing or old round history is changed.

## Verification completed locally

- Lint, application/node TypeScript and production build.
- Existing UID, scan cancellation, wallet retry and admin void tests.
- Real independent PostgreSQL-session tests: concurrent duplicate requests,
  paid-entry eligibility, cross-operator cooldown, award/void races, blocked bands,
  game assignments, public coupon contract, service-role redemption and reissue.
- Actual React hook tests: frozen identity, refresh, late response after navigation.
- Mocked browser checks and NFC events, including mobile/desktop QR regressions.

The focused SQL fixture is NOT a complete Supabase migration replay. No physical
NFC, real hosted role session, live payment or genuine email delivery is claimed.

```sh
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
npm run build
npm run test:pos-controls
node --test scripts/test-award-client.mjs
PINKD_EMBEDDED_POSTGRES_ROOT=/path/to/runtime node --test scripts/test-direct-award-concurrency.mjs
PINKD_PLAYWRIGHT_ROOT=/path/to/node_modules PINKD_TEST_URL=http://127.0.0.1:8096 node scripts/test-award-browser.mjs
```

## Release gates

1. Finish and release cash first. Reconcile this branch with the released cash
   changes, retaining BOTH readiness gates and generated type additions.
2. Use the existing production database only, as approved. Do not create a test
   database or extra Git branch. Hosted staging is waived. Run combined local
   checks, then verify schema types and permissions against the deployed backend.
3. Inspect outstanding rounds again immediately before switching terminals.
   A read-only production query during implementation returned no rounds; that
   is not a guarantee about future state. Do not silently close/refund rounds.
4. Review production migration dry run carefully: award migration
   `20260907191000_pinkredibles_award.sql` sorts BEFORE the cash migration. Use
   reviewed out-of-order migration handling; exclude unrelated migrations.
5. Deploy reviewed backend first; verify eligibility, durable retries, cooldown,
   award/void protection and direct_award_backend_version=1, then
   merge main and verify automatic frontend deployment. Keep rollback deployment
   available and reload all terminals.
6. Before venue NFC operations, complete Android winner-scan -> lookup -> late
   NFC read rehearsal; require one award and no extra charge. Test lost responses
   and refresh on the actual phone. This hardware check remains outstanding.

Do not promote based only on simulated browser or focused SQL results.
