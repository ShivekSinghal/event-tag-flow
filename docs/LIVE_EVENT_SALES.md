# Live Event Sales

Open Dashboard > Live Sales as an admin. This is a read-only all-time report.
The active tab refreshes every 15 seconds, when browser visibility returns,
on focus/reconnect, and through Refresh. Failed refreshes retain the last
successful snapshot with a stale warning. Initial failures do not show zero.

## Counting

- Paid/completed event line items count as sold; live pending/manual-payment
  reservations count only as holds. Missing expiry uses creation + 15 minutes,
  matching checkout. The query never expires orders or advances phases.
- Stored quantity times stored pax contributes to each recorded intensive and
  the party for party/package/group categories. A full pass adds five admissions.
- Event line totals count once, excluding coin lines even in mixed orders.
- Paid Orders counts distinct paid orders containing event items, not coin-only orders.
- Session labels and capacity come from event_sessions. Invalid/missing/duplicate
  stored slot assignments, unknown package keys, unexpected crew pax, or a missing
  session catalog produce warnings rather than invented assignments.
- Party capacity is not inferred from phase limits. Its unconfigured table cells
  show a dash. Admissions are not unique people.

## Security And Verification

get_event_live_sales is STABLE, SECURITY INVOKER, with an explicit admin check.
PUBLIC/anon execution is revoked. Existing RLS remains in effect.

Run npm run test:live-sales, npm run lint, npx tsc --noEmit,
npx tsc --noEmit -p tsconfig.app.json, and npm run build.
The tests use an isolated PGlite PostgreSQL database and mocked network calls;
they do not create or change production orders. They cover all package types,
crew quantities, mixed coin carts, expiry, refunds, duplicate status updates,
invalid slots, >1,000 orders, role denial, polling, errors and cancellation.

## Deployment Checkpoint (7 September 2026)

- Additive RPC migration applied as 20260907130823; generated function type verified.
- Real admin/RLS read returned sessions 12/13/9/12, party 19, total admissions 65,
  paid event orders 25, revenue INR 88,289, no holds or data warnings.
  These figures are a timestamped check, not constants in the application.
- Desktop and 390px phone visual checks used the actual component with a fixed
  local snapshot. Phone table scrolls horizontally within its own container.
- Preview: https://event-tag-flow-369oc38pg-shiveks-projects.vercel.app/dashboard
- Preview is Vercel-login protected. End-to-end sign-in as an admin on this new
  preview origin still needs an authorized browser session; do not bypass auth.
- Production frontend was not promoted. No NFC, payment, booking or wallet code changed.
- Existing project-wide Supabase advisories were not remediated in this report-only
  change. The new invoker function is not an anonymous SECURITY DEFINER endpoint.
