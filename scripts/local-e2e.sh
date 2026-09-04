#!/usr/bin/env bash
# Local end-to-end helper for the Pink'd booking site.
# Requires: colima/docker running and `supabase start` done in this repo.
#
#   scripts/local-e2e.sh status              live party status (what /api/party-status returns)
#   scripts/local-e2e.sh orders              recent orders with ref, status, source, total
#   scripts/local-e2e.sh pay <REF>           mark an order paid (stands in for the Cashfree webhook) and run the
#                                            same follow-ups the webhook runs: auto-credit coins to the linked band
#   scripts/local-e2e.sh bands               wallets with balance, status and linked booking
#   scripts/local-e2e.sh sql "<query>"       run arbitrary SQL as postgres
#   scripts/local-e2e.sh reset               wipe the local DB, re-apply all migrations and supabase/seed.sql
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."

DB=$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1 || true)
if [[ -z "$DB" && "${1:-}" != "reset" ]]; then
  echo "Local Supabase is not running. Start it with: supabase start -x imgproxy,logflare,vector,realtime,supavisor" >&2
  exit 1
fi

psql_run() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

case "${1:-}" in
  status)
    psql_run -qtAc "SELECT jsonb_pretty(public.get_event_party_status());"
    ;;
  orders)
    psql_run -c "SELECT upper(left(id::text,8)) AS ref, customer_name, payment_status, booking_source,
                        total_amount_inr AS inr, to_char(created_at,'DD Mon HH24:MI') AS created,
                        CASE WHEN parent_order_id IS NULL THEN '' ELSE upper(left(parent_order_id::text,8)) END AS parent
                 FROM public.event_orders ORDER BY created_at DESC LIMIT 25;"
    ;;
  pay)
    REF="${2:?usage: pay <REF>}"
    psql_run -c "
      WITH o AS (
        UPDATE public.event_orders
        SET payment_status = 'paid', payment_provider = 'cashfree',
            payment_reference = coalesce(payment_reference, 'local_' || lower('$REF')), paid_at = now()
        WHERE upper(left(id::text, 8)) = upper('$REF')
        RETURNING id, booking_source
      )
      SELECT upper(left(o.id::text,8)) AS ref, o.booking_source,
             CASE WHEN o.booking_source = 'coins_page' THEN public.auto_credit_coin_order(o.id) ELSE '{\"note\":\"ticket order paid\"}'::jsonb END AS coin_credit
      FROM o;"
    ;;
  bands)
    psql_run -c "SELECT w.tag_id, w.attendee_name, w.attendee_phone, w.coin_balance, w.status,
                        CASE WHEN w.event_order_id IS NULL THEN '' ELSE upper(left(w.event_order_id::text,8)) END AS booking
                 FROM public.wallets w ORDER BY w.created_at;"
    ;;
  sql)
    psql_run -c "${2:?usage: sql \"<query>\"}"
    ;;
  reset)
    supabase db reset
    ;;
  *)
    sed -n '2,12p' "$0"
    ;;
esac
