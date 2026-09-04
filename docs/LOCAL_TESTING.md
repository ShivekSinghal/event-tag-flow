# Pink'd booking site — local end-to-end testing

Everything except the two external services (Cashfree payments, Resend email) can be
tested on one Mac with no cloud project involved.

## One-time setup (already done on Manas's Mac mini, 4 Sep 2026)

```bash
brew install node colima docker supabase/tap/supabase
colima start --cpu 4 --memory 6 --disk 40
```

## Start

```bash
cd "/Users/bbuzz/Pinkd 2026/event-tag-flow"
supabase start -x imgproxy,logflare,vector,realtime,supavisor   # DB + API + auth + edge runtime, applies all migrations + seed.sql
npm run dev                                                      # site on http://localhost:8080 (uses .env.local → local Supabase)
```

Stop with `supabase stop` (keeps data) and `colima stop`. `scripts/local-e2e.sh reset` wipes the
database and re-applies every migration plus `supabase/seed.sql`.

Local Studio (database UI): http://127.0.0.1:54323

## Logins (local only)

| Role  | Email               | Password         |
|-------|---------------------|------------------|
| admin | admin@pinkd.local   | Pinkd-Test-2026  |
| staff | staff@pinkd.local   | Pinkd-Test-2026  |

Sign in at http://localhost:8080/pinkd-login. Admin sees /dashboard; both see Issue Tag, Top Up, POS.

## Seeded bookings (refs are printed by `supabase db reset`; or run `scripts/local-e2e.sh orders`)

| Booking | Who | State |
|---|---|---|
| Crew of 6 | Manas, 9205488417 | Paid. 3 of 6 attendee names saved (Manas, Priya 9811022334, Rahul 9987011223). ₹2,000 coin pack bought online, **waiting** for a band. |
| Party × 2 | Aditi, 9876500001 | Paid. No names yet → attendee form required. |
| Full Pass | Karan, 9876500002 | Paid. Band `NFC0K4R4N` already issued and linked. ₹5,000 pack bought after issue → **6,000 coins already on the band**. |
| 4 Intensives | Neha, 9876500003 | Paid. No party → /coins refuses her. |
| Party × 1 | Ghost Buyer | Abandoned checkout, hold expired → auto-cancelled on the next status poll. |

## Standing in for Cashfree

The local stack has no Cashfree keys, so clicking Pay creates the order and then shows
"Payment Setup Failed" with the order saved as pending. That is expected. To complete it the
way the webhook would:

```bash
scripts/local-e2e.sh orders          # find the 8-char ref
scripts/local-e2e.sh pay 1A2B3C4D    # marks paid; for a coin order also credits the linked band
scripts/local-e2e.sh status          # live meter / phase / seats
scripts/local-e2e.sh bands           # wallets, balances, linked bookings
```

## Issue Tag without NFC

Desktop browsers have no Web NFC. In local dev (`npm run dev`) Issue Tag shows a
"Type a tag ID (dev only)" field under the scan button; it is not rendered in production
builds. Use any id like `NFC0TEST1`.

## Test script (mirrors the list sent to Shivek)

1. **Meter** — home page shows "N of 50 Phase 1 spots left" (seed: 9 booked). Green dot.
2. **6 PM reveal** — before 18:00 IST on 4 Sep, 1 & 2 Intensive cards are absent and the
   checkout refuses them; after, they appear without reload.
   Quick check: `scripts/local-e2e.sh sql "UPDATE public.event_packages SET available_from = now() - interval '1 minute' WHERE id IN ('one-intensive','two-intensives')"` then watch the page.
3. **Checkout** — add 2 Intensives (pick exactly two sessions), Pay → order created, gateway fails (expected) → `pay <REF>` → meter moves.
4. **Attendee form** — `/attendees?ref=<crew ref>`: rows 1–3 filled, 4–6 empty. Try giving row 4 Priya's phone → refused. Save a new row → saved.
5. **Freeze** — log in as admin → Issue Tag → find `9811022334` → autofill Priya → type tag `NFC0PRIYA` → Create. Reload `/attendees?ref=<crew ref>`: Priya's row is read-only with "Issued · band ···YA".
6. **Prepaid coins load at the gate** — the crew's ₹2,000 pack: on Issue Tag the booking shows "2,000 coins waiting"; issuing Priya's band with the tick-box on loads them (`bands` shows 2000 on NFC0PRIYA).
7. **Self top-up after issue** — `/coins` → type `9876500002` (Karan) → his band ···R4N with 6,000 coins → add a pack → Pay → `pay <REF>` → balance updates on the page within 45 s (or reload).
8. **Crew top-up asks whose band** — issue a second crew band (e.g. Rahul, `NFC0RAHUL`), then `/coins` with the crew ref: picker "Whose band are these coins for?"; Pay disabled until chosen. With Rahul's phone typed instead, his band is pre-selected.
9. **Reissue lost band** — Issue Tag → find `9876500002` → bands list shows Karan's ···R4N → type new tag `NFC0KNEW1` → "Reissue lost band" → old band blocked, 6,000 coins moved (`bands`).
10. **Admin report** — /dashboard → Event Bookings: ticket vs coin revenue, phase price on party lines, attendees, CSV export. Party Phase & Seats tab is read-only.
11. **Expiry** — `orders` shows Ghost Buyer cancelled after the first status poll.

## What cannot be tested locally

* Real Cashfree checkout modal and webhook signature (needs sandbox keys in edge-function secrets).
* Confirmation emails (Resend key). The templates render server-side in `supabase/functions/_shared/eventEmail.ts`.
* `/api/party-status` as a Vercel function. Locally the page falls back to the same database function directly.

## Hosted disposable test stack (4 Sep 2026)

Same code and seed as the local stack, but reachable from any phone, with the real Cashfree
sandbox modal, webhook, Resend emails and the Vercel `/api/party-status` function.

* Site: https://pinkd-e2e-test.vercel.app (Vercel project `pinkd-e2e-test`, team hashtag-mentorship).
  Only the production URL is public; preview deployments sit behind Vercel Authentication.
* Database: Supabase project `gauftkiluglpheqtzmuw` (Singapore, org "Pinkd Test"). Schema was loaded
  from `supabase db dump --local` in seven chunks via the Supabase connector, then the catalog rows
  (packages, phases, sessions, coin packs, POS items), the `on_auth_user_created` trigger and
  `supabase/seed.sql` were run by hand. The project's migration history is therefore empty; do not
  `supabase db push` against it without `supabase migration repair` first.
* Logins are the seed logins (`admin@pinkd.local` / `staff@pinkd.local`, `Pinkd-Test-2026`).
* Edge functions + secrets: `supabase functions deploy --project-ref gauftkiluglpheqtzmuw` and
  `supabase secrets set --env-file supabase/functions/.env --project-ref gauftkiluglpheqtzmuw`.
  Cashfree sandbox webhook must point at
  `https://gauftkiluglpheqtzmuw.supabase.co/functions/v1/event-payment-webhook`.
* Redeploy the site after code changes: `vercel --prod` from the repo (env vars already set).
* Reset data: run the "Seed logins + bookings" part of `supabase/seed.sql` again after
  `TRUNCATE public.event_orders, public.wallets, public.transactions, public.event_order_attendees CASCADE`.
  Nothing here is production; the whole project can be deleted after the event.
