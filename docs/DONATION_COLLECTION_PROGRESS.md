# Circular Collection Progress

The admin-only donation screen uses a INR 1,000,000 goal and the supplied Hashtag logo. Positive increases fly upward; INR 2,500+ adds a double ripple, and INR 10,000+ adds gold accents and brief confetti. Larger updates count up for longer. Updates arriving between snapshots are combined as "New top-ups", not attributed to an invented donor. Initial loads do not replay contributions. Reduced motion skips effects.

The read-only invoker RPC counts paid/completed historical coin order lines plus standalone positive-INR wallet loads/purchases. It excludes ticket lines, pending/failed/cancelled/refunded orders, NFC spends, bonus/zero-INR credits and coins:/prepaid: fulfilment references. No coin-to-rupee fallback is allowed. Missing recorded INR is surfaced for reconciliation. Counts aggregate beyond the REST row limit.

Explicit TEST-prefixed target bands and their direct top-ups are excluded. The schema has no general historical test-payment flag: unmarked real-money rehearsal payments need separate reconciliation. Real blocked/reissued bands are not automatically excluded. The retained transaction Excel export is a wallet ledger, not an export of paid order coin lines.

Realtime invalidates the absolute server snapshot, with visible-tab polling every 15 seconds, manual refresh and return-to-tab/reconnect refresh. Errors retain last-known data. New targets cancel obsolete flights without restarting the arrival deadline indefinitely. Refunds reconcile downwards without a celebration.

Release order: test, apply only the donation_collection_progress migration, verify authenticated admin and anonymous/staff denial, then push/deploy frontend. No payments, wallets, bookings, roles, NFC operations or existing migration files are modified.

Checks: npm run lint; npx tsc -p tsconfig.app.json --noEmit; npm run build; node --test scripts/test-donation-progress.mjs; browser tests on 375/390/1440px with mock responses only. Never create a real donation just to trigger the animation.

## Release Verification (11 September 2026)

All checks above passed. Browser tests additionally covered duplicate/racing snapshots, refund decreases, offline recovery, reduced motion, fullscreen, polling and staff denial. These are simulated collections, not real payment tests.

Production migration version: 20260911061618. At 06:18 UTC the admin RPC returned INR 26,000 across four collections, goal INR 1,000,000 and zero unpriced top-ups. Independent source totals reconciled to INR 24,000 in paid coin order lines plus INR 2,000 in standalone top-ups. Staff received permission denied; anonymous execution is revoked. No new function-related security advisory appeared; existing project advisories remain outside this release.

Previous production deployment for frontend rollback: dpl_5ZZM7Ws9FpfnJ5ho98puoN7s4JE2 (event-tag-flow-kqr0j4r3p-shiveks-projects.vercel.app). The additive read-only RPC can remain installed if the frontend is rolled back.
