# Cash production rollout - 8 September 2026

## Completed

- Supabase CLI authenticated with user approval.
- Existing production project only: `xdaienqjbybomctsoiro`.
- Production migration history fetched into an isolated local deployment
  directory. No history repair, test database or new Git branch was created.
- Dry run listed only `20260907192000_cash_bookings.sql`; that migration was
  applied and its original version is recorded in production.
- Configured a securely generated `CASH_BOOKING_CODE_SECRET` and the user-approved
  sender `PINK'D <universal@hashtag.dance>`. Secret values were not printed.
- Deployed `cash-booking`, `event-payment-create`, and `event-payment-verify`
  from cash release commit `27ee254`.
- Production backend build gate passed, including cash database version 1 and
  Edge Function readiness. Cash GET returned HTTP 200 and ready=true;
  unauthenticated cash POST returned HTTP 401.
- Cash private tables have RLS enabled and no PUBLIC/anon/authenticated grants.
  Management helpers are service-role-only. Public creation and token-protected
  receipt lookup remain intentionally available.
- Existing three admins pass the database studio authorization predicate;
  all nine staff accounts are denied. No manager accounts or assignments exist.
  These predicate checks are not separate signed-in browser session tests.
- The cash gateway-protection trigger is enabled. The live party-status endpoint
  remains healthy. There were no unfinished rounds at verification time.
- Supabase advisors returned no ERROR findings. Cash-specific warnings cover
  intentional public checkout/status RPCs, role-checked listing/assignments and
  private RLS tables with no client policies. Existing platform warnings remain.

## User-assisted cash check completed

The user reported completing the genuine cash check. Booking `E0895BF0` is paid
for INR 2,000 at Preet Vihar, confirmed at 00:52:41 UTC on 8 September 2026.
Code, confirmation and alert notifications each have one provider ID and status
sent, with no recorded error. These records prove provider acceptance, not an
independent recipient-inbox inspection. Party booked count changed from 29 to 30;
held count is zero, session counts are unchanged and no duplicate notification
generation exists. The agent did not mark the order paid or simulate cash receipt.

Use the already existing protected cash preview:
`https://event-tag-flow-dezq14rgg-shiveks-projects.vercel.app/?counter=1`
and its `/cash-booking` route. Hosted staging is waived; this preview connects to
the production backend. Do not create a separate test database or branch.

Main and production frontend were on `884076d` before release. The cash check
now permits merging/pushing cash first. Verify automatic deployment, then deploy the reviewed
award migration with explicit out-of-order handling and release awards.
The combined implementation was locally merged as `828b111`; its lint, app/server
TypeScript, build, 33 database/recovery tests, 42 POS-control tests and mocked
cash/award/QR browser regressions passed before backend deployment.

## Rollback and outstanding checks

Recorded previous production deployment:
`dpl_2LQJcYUFp8VT9nfwGBjx8tC6wVDe`
(`event-tag-flow-lprnbu32b-shiveks-projects.vercel.app`).

Do not blindly reverse migrations or remove transaction records during rollback.
Physical Android scan-to-lookup rehearsal remains mandatory before venue NFC
operations. Reload all terminals after release. Real manager-session verification
requires the user's manager roster and studio assignments.
