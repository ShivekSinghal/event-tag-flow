# Live Sales: Studios and Attendance

## Included

- Studio matrix with entered / booked counts for all four intensives and the party.
- Intensive/party links open the paid-admission roster. Studio cells open it pre-filtered.
- Search guest/booker names, phones, email, package or booking reference; filter by studio and entry status.
- Full-screen mode is retained for the matrix and attendee view.
- Each purchased seat is identified by order item, admission index and event number (0 = party).
- Check-in records the guest, time and admin. Undo requires the current check-in timestamp and records the undo operator/time. Re-entry replaces the row's current check-in metadata; this is not an append-only historical event log.
- Existing booking, payment, capacity and NFC data are not mutated by check-in.

## Identity and Studio Rules

Studio means the booking customer's `customer_studio`, not the cash-collecting studio or a presumed home studio for every crew member. Blank values appear as `Not specified`.

Party-bearing items map saved attendee names in `(created_at, id)` order, then seat order. This includes the intensive admissions belonging to those same bundle/crew items. Intensive-only items do not inherit names from separate party purchases. For an order with exactly one purchased event ticket, the booking contact is the guest fallback. Missing names/phones must be entered in the confirmation dialog before check-in. These captured details belong to this admission's check-in record and do not overwrite the public attendee form.

## Access and Release

The dashboard remains admin-only. Neither staff nor studio managers gain attendance access in this change. RPCs enforce the admin role; reads use existing RLS. Browser clients cannot directly insert/update/delete check-ins.

Apply `supabase/migrations/20260908210427_event_admission_roster_and_checkin.sql` before releasing the frontend. It adds one table, an invoker view, a report RPC and a guarded mutation RPC. It does not alter the existing sales RPC. If missing, the attendee section shows a readable error while existing Live Sales continues to work.

The migration was applied to production on 9 September 2026 (IST), before the frontend release. Read-only validation matched all studio totals against Live Sales, including 37 Intensive 1 admissions, with zero check-in records created. No real guest was checked in during development or release verification.

## Verification

```sh
node --test scripts/test-event-attendance.mjs scripts/test-live-sales.mjs scripts/test-live-sales-refresh.mjs
npm run lint -- --max-warnings 0
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
npm run build
```

Browser fixture test (run against Vite on port 8090, or set `ATTENDANCE_PREVIEW_URL`):

```sh
node scripts/test-event-attendance-browser.mjs
```

The browser test needs Playwright installed/resolvable (or `PLAYWRIGHT_MODULE` pointing to its module) and a Chromium browser. `BROWSER_CHANNEL=chrome` uses installed Chrome. It intercepts all backend requests with sample data and blocks unrelated external requests; it is not a production integration test. Screenshots default to `/tmp/pinkd-attendance-preview`.

Before production use: apply the migration, test with a real admin and a restricted account, and exercise two simultaneous terminals against a non-customer test admission. PGlite tests validate PostgreSQL rules and repeated calls but are not independent multi-connection concurrency tests.
