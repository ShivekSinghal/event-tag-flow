# Full NFC UID release checks

The scanner now emits `NFC` followed by every hexadecimal UID byte in uppercase.
Colons, hyphens and spaces between bytes are removed; leading zeros are retained.
Only `serialNumber` supplies a hardware identity. Missing/malformed serials fail;
tag-written records are never used. No tag writes are introduced.

Issue Tag, reissue, Top Up, Check Coins, POS admission and winner scanning use the
same scanner output. `TagIdentifier` abbreviates only the rendered label; tapping
it reveals the complete stored ID. Phone/name lookup continues to use wallet IDs.
Development/test-only typed labels keep their complete trimmed uppercase value.

## Automated checks

```sh
node --test scripts/pos-scan.test.mjs
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
npm run build
```

Tests cover shared-prefix collisions, leading zeros, full UID query arguments,
normalization, missing/malformed serials, ignored records, typed-test gating,
cancelled scans, late reads, lookup takeover, blocked/insufficient wallets and
one-shot ordinary/round payments. They simulate NFC and database I/O, not hardware.

## Compatibility gate before any release

Recheck production read-only immediately before promotion:

```sql
select case
  when tag_id ~ '^NFC[0-9A-F]{6}$' then 'legacy_six_hex'
  when tag_id ~ '^NFC[0-9A-F]+$' then 'prefixed_hex_other_length'
  when tag_id ~ '^[0-9A-Fa-f]+$' then 'unprefixed_hex'
  else 'manual_or_other_format'
end as tag_format, status, count(*) as wallet_count
from public.wallets
group by 1, status;
```

The September 7 pre-change audit found one active manual/nonstandard ID and no
legacy six-hex IDs. Leave that record untouched and available to confirmed lookup.
If truncated IDs appear, stop promotion and reconcile each through a verified
physical rescan and owner confirmation. Lost bytes cannot be reconstructed, and
prefix matching is unsafe. No automated wallet rewrite or schema change is included.

## Physical rehearsal (not yet completed)

Use two NFC-capable Android phones with Chrome and three actual bands on a test
stack. Do not write a URL or any data to the bands.

1. Record each full hardware serial. Issue each band on phone A and verify its
   stored `tag_id` retains all bytes and is distinct from the other bands.
2. Scan all three on phone B in Top Up, Check Coins and POS; confirm the correct
   attendee and balance every time. Tap each shortened ID to inspect it.
3. Credit and spend test coins. Begin a scan, switch to confirmed phone lookup,
   then tap the band; require one debit, not two.
4. Admit round players and scan an eligible winner. Confirm exact wallet identity
   and one reward. Reject a band that did not pay into the round.
5. Reissue one band to a spare/test replacement. Verify the replacement stores
   its full UID and the old band remains blocked; balances and rewards move once.
6. Verify a missing-UID/unsupported band fails without creating a wallet or sale.
7. Inspect IDs at mobile width and with keyboard focus; the full ID must be
   inspectable without horizontal overflow. Confirm the manual wallet still works
   through the existing name/phone confirmation flow.

No commit, push, database mutation or production deployment is part of this change.
