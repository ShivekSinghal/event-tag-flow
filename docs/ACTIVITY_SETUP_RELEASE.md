# Activity setup release

Status: local implementation only. Production deployment and staff changes require approval.

## Deployment preflight (8 September)

- Remote main remains `f9ae891`. The activity change is released on its own branch while the Android test result is unconfirmed.
- Production rollback target recorded before this release: `dpl_DgnczusvvSKnkiJh4V8mwvGW9hmT` (`event-tag-flow-hc2bsyk53-shiveks-projects.vercel.app`).
- `supabase db push --dry-run --skip-vault` detects historical remote migration versions absent under those timestamps locally. Do not run the suggested blanket migration-history repair. Reconcile the historical versions separately or apply only this reviewed migration through the migration API and record the resulting version before promotion.
- A frontend preview alone does not install activity metadata. The live backend, accounts, and assignments remain unchanged until the backend release gate is cleared.

## Local verification completed

- Lint: zero errors/warnings. Root and application TypeScript checks pass. Production build passes with the existing bundle-size/Browserslist warnings.
- Activity SQL/validation suite: 16 passing tests including existing retry regression coverage. Existing POS controls suite: 42 passing tests.
- Mocked browser checks pass at 390px and 1440px: grouped visibility, free activities, donation input, 30-second manual lookup, late NFC, double confirmation, reload/retry recovery, staff groups, and admin saves.
- Types for the new columns were checked against PostgreSQL catalog definitions. Full CLI type regeneration/fresh-stack replay was not run because Docker is unavailable; the SQL tests use PGlite.
- No live wallet debits, production migration, staff assignments, or Akash account creation occurred. Hosted concurrent-client tests and physical Android verification remain pending.
- The shared main layout now permits flex shrinking so the dashboard's scrolling tab strip does not stretch the activity editor off-screen on phones.

## Scope

- Tier 1: Shoot Your Shot, Spin the Wheel, Wing Person for Hire, 450 coins.
- Tier 2: Hurdle, Cricket, Issue With a Tissue, 750 coins.
- Tier 3: Limbo, Bombastic, Minute to Win It, 1,000 coins.
- Free: Red Flag Green Flag, Jamaal Challenge, Squid Games, Beer Pong. No scan, debit, participation record, or award.
- Donations: Karaoke and Busk for a Cause, whole coins at least 150. Admins can increase the minimum.
- Coin Admin Console > Game Prices controls group, pricing mode, availability, and price/minimum.
- Existing reward eligibility for the six paid prize games is preserved. Coin spending has null INR and does not increase the donation-progress INR total.

## Before release

1. Review the single additive metadata migration and replacement validation functions. Existing canonical IDs are reused; only Busk is inserted. Fresh databases without the operational activity records are not silently populated with replacement IDs; the assignment preflight fails until the canonical records are present.
2. Run `node --test scripts/test-activities.mjs`, existing wallet/POS tests, lint, application TypeScript, and build. PGlite exercises actual migration and RPC SQL but serializes concurrent queries; it is not a multi-connection load test.
3. Run the local browser suite with `PINKD_TEST_URL` and `PINKD_PLAYWRIGHT_ROOT`. This mocks all Supabase traffic and performs no production charges.
4. On the hosted preview database, test simultaneous callers, lost responses, blocked/insufficient bands, and every operator's access. Verify the new numeric `spend_wallet_coins` signature appears in the API schema after reload.
5. On Android Chrome, start a donation scan, open phone lookup, wait 30 seconds, then tap a band while confirming lookup. Require exactly one debit. Repeat after denying/delaying NFC permission and after scan timeout.

## Approved deployment order

1. Apply only the reviewed `20260908131049_activity_groups_and_donations.sql` migration. Do not include unrelated migrations or scratch directories. Check the migration dry run first. Do not downgrade the database if reverting only the frontend.
2. Deploy a protected frontend preview, verify, and obtain production promotion approval. An old client's custom-game request without a game ID is intentionally rejected with an activity-unavailable message; upgrade staff phones before opening donations.
3. After account-change approval, run `scripts/provision-akash-staff.mjs` with `--apply --approved-project xdaienqjbybomctsoiro --credentials-out /absolute/private-directory/akash.json`. Set the service-role key through a protected environment, never in Git or command arguments. Directory mode must be 700; output mode is 600. Deliver this one password privately to Akash. The script never resets an existing account.
4. Run `scripts/apply-activity-staff.sql` in a trusted administrator database session. It fails atomically if profiles, roles, canonical games, or prices differ. Expected result: 33 game assignments across 9 staff operators. It never grants roles, food/drinks, or cash-manager access.
5. Check actual logins and assigned groups. Tarun's personal Gmail receives Tier 2; `tarun@hashtag.dance` stays unassigned. Owner admin and unrelated accounts/permissions remain untouched.
6. Confirm receipts, per-game coin reports, zero INR on these debits, six prize games' eligibility, and free activities' lack of action controls. Watch rejected operations during the staff-phone refresh.

Do not run provisioning or assignments against production merely to test them. No production or physical-device verification is implied by local tests.
