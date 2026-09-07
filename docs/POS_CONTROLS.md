# Patch 2: POS Controls

## Operator Behaviour

- POS keeps the last successful ordinary-sale receipt per signed-in operator in session storage. It survives navigation and refresh in the same tab. Selecting an item, topping up, or rejecting a subsequent sale does not replace it. It is a historical balance, not a live wallet balance.
- Insufficient coins produce a persistent top-up instruction. Admins/studio managers can open Top Up; restricted staff direct the attendee to the top-up desk. A fresh scan is required after topping up.
- Only admins see sale-void controls. They can void their last sale or find a staff sale by its complete transaction UUID. A reason and confirmation are required.
- Void controls remain disabled during an ordinary sale scan, lookup, active round, or unresolved wallet operation.

## Refund Contract

`void_pos_sale(p_operation_id uuid, p_request jsonb)` accepts `kind: "void"`, `wallet_id`, `sale_transaction_id`, and a 3-500 character `void_reason`.

Authentication and the current admin role are checked on every call, including retries. Anonymous execution is revoked. Wallet-operation tables retain their existing private grants and RLS.

The transaction, wallet and operation ledger update atomically. The original negative-coin sale remains untouched. A new positive `refund` row stores `reverses_transaction_id`, `balance_after`, `void_reason`, actor and timestamp. Sale-row locking plus a unique reversal index permits exactly one refund even across different operation IDs. Matching retries return the original refund receipt; changed payloads or operators are rejected.

Only ordinary games/food/drinks sales qualify. Round entries, top-ups and previous refunds cannot be voided. Inactive or blocked original bands require separate admin reconciliation; the RPC does not guess a replacement wallet. No INR payment or gateway refund is created, and no Pinkredible is changed.

The frontend persists the frozen void operation before submitting and uses the existing safe retry panel for uncertain responses. Dashboard sales breakdowns remain gross; coin refunds are displayed separately and remain visible as ledger entries.

## Verification

- `npm run test:pos-controls`: SQL business rules and permissions, rollback, immutable original sale, retry receipt persistence, NFC/lookup regression tests and production readiness gate.
- `PINKD_EMBEDDED_POSTGRES_ROOT=<runtime> node --test scripts/test-wallet-retry-concurrency.mjs`: separate real PostgreSQL sessions race both identical and distinct void operation IDs against one sale and assert one refund.
- `PINKD_PLAYWRIGHT_ROOT=<node_modules> PINKD_TEST_URL=http://127.0.0.1:8093 node scripts/test-wallet-retry-browser.mjs`: actual React UI in Chrome at 390px/1440px with all external I/O mocked. Covers receipt refresh, admin confirmation, uncertain void/retry, restricted-staff controls, insufficient balance and top-up regression.
- `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`, `npx tsc --noEmit -p tsconfig.node.json`, `npm run build`.

SQL tests use isolated fixtures with the actual spend/credit/retry/void functions. They are not a complete Supabase migration replay or a production canary. Browser role profiles and network responses are synthetic. Physical Android NFC, actual staff/admin sessions, and hosted preview validation remain required before venue release.

## Release Order

1. Review and apply `20260907184809_pos_sale_void_controls.sql` after the existing retry and Pinkredibles migrations to the approved backend.
2. Verify authenticated admin/staff access and refund concurrency on the hosted preview stack.
3. Deploy the reviewed frontend and reload terminals. The production build gate now requires both retry and void RPCs and denies release while either is missing or anonymously executable.

Existing main auto-deploy makes database-first release order important. Fixed-item pricing hardening remains a separate task.

### Production Backend Applied: 8 September 2026 (IST)

Applied the reviewed SQL to production project `xdaienqjbybomctsoiro` with explicit user approval. The connector-generated migration-history version was aligned to repository version `20260907184809`; no other migration-history rows were changed. The deployed function body matches the local migration exactly.

Verified the reversal index is unique/valid, all three audit columns exist, RLS remains enabled, authenticated direct inserts are denied, and anonymous RPC execution is denied. An authenticated request without an identity is rejected. The production readiness probe passes for both retry and void RPCs. Before/after: one wallet, 2,000 total coins, one transaction, zero wallet operations. No customer sale or refund was created for verification.

The security advisor added the expected [authenticated SECURITY DEFINER warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) for `void_pos_sale`; authenticated execution is intentional and the function checks the current admin role before any operation or replay. Existing advisories are unchanged.

At the time of the backend migration, the Patch 2 frontend was still local; no main push or frontend deployment was bundled with that migration. Hosted role-session and physical NFC checks remain outstanding.
