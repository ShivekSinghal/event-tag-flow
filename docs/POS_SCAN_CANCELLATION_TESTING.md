# POS Scan Cancellation Checks

Run `node --test scripts/pos-scan.test.mjs` from the repository root. The suite
executes the actual NFC manager and POS handlers with fake clocks, readers and
database responses. It does not connect to Supabase or debit real wallets.
The same suite also checks round entry when run on the Pinkredibles branch.

Covered races: lookup open during scanning, lookup open during wallet fetching,
late permission completion, duplicate confirmation, timeout and explicit retry,
blocked bands, insufficient coins, and the phone-lookup audit marker.

## Android Chrome Release Gate

Use a dedicated test wallet and game, with a recorded starting balance.

1. Select a game, then immediately tap "Can't scan? Find by phone or name".
2. Wait at least 30 seconds. Confirm the same selected item and price remain.
3. Tap the NFC band while lookup is open. It must not charge or close lookup.
4. Search and select the test wallet. Double-tap "Use this band". Confirm exactly
   one debit in the transaction report and `via:phone-lookup` in its reference.
5. Start another sale, open and close lookup. Scanning must stay stopped until
   "Scan NFC instead" is pressed. Tap the band after that explicit restart.
6. Let a normal scan expire without opening lookup. Confirm the item remains and
   both retry and manual lookup are available.
7. Repeat with a blocked band and a balance below the price. Neither may debit.
8. On Pinkredibles, repeat the takeover while admitting a round player. The round
   must remain open and add the confirmed player only once.

Desktop simulations cannot prove Android NFC hardware cancellation. Do not
promote this fix based on those simulations alone. No database migration is needed.
