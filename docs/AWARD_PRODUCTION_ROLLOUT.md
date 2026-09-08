# Direct awards production rollout - 8 September 2026

Cash shipped first as main commit `2c94538`, automatically deployed by Vercel as
`dpl_91jKMMrEdb2M6e1NexZHed2Np8BX`. The genuine user-assisted cash booking
`E0895BF0` is paid; code, confirmation and alert were accepted by the provider.
See CASH_PRODUCTION_ROLLOUT.md for evidence and verification limits.

The award migration was then applied to existing production project
`xdaienqjbybomctsoiro`. A temporary local migration directory contained fetched
production history and only the two reviewed release migrations. The out-of-order
dry run with `--include-all --skip-vault` listed exactly
`20260907191000_pinkredibles_award.sql`; only that pending migration was applied.
Its original timestamp is recorded. No test database, Supabase branch, additional
Git branch or unrelated migration was created/applied. No rounds were closed.

## Verified

- Both production readiness functions return 1; cash Edge readiness passes.
- Award and eligible-entry RPCs reject anonymous HTTP requests with 401.
- Internal permission and void helpers are not executable by application roles.
- The durable award operation table has RLS and no client grants.
- Unique paid-entry award index and awarded-entry void trigger are active.
- Existing admin/studio-manager ledger policy and redemption contract remain.
- There were zero unfinished rounds at the deployment check.
- Combined lint, app/server TypeScript and production-gated build pass.
- 33 focused local database/recovery tests and 42 POS-control tests pass.
- Mocked cash/award role-view and refresh-recovery browser tests pass.
- Supabase security advisors report no ERROR findings. Intentional public coupon
  and role-checked RPC warnings, private RLS/no-policy notices and pre-existing
  platform recommendations remain; this is not a full security certification.

## Remaining operational checks

Real separate staff/manager browser sessions require the assigned operator
accounts. Physical Android scan-to-lookup and late-read rehearsal remains
mandatory before venue NFC operation. Simulated browser/NFC tests are not hardware
verification. Reload all terminals after release and explicitly assign prize
games to stall operators. Do not create artificial paid entries or rewards merely
to simulate production sales.

Keep the cash deployment above as the immediate frontend rollback target. The
pre-cash deployment `dpl_2LQJcYUFp8VT9nfwGBjx8tC6wVDe` is also recorded. Do not
delete transactions or blindly reverse migrations when rolling back the frontend.
