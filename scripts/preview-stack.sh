#!/usr/bin/env bash
# Disposable end-to-end test stack: your own Supabase project + Vercel preview from this branch.
#
# One-time, by a human (logins cannot be scripted):
#   supabase login                      # opens the browser
#   vercel login                        # emails a sign-in link
#   supabase secrets set --env-file supabase/functions/.env --project-ref <REF>   # Cashfree sandbox + RESEND_API_KEY if you have one
#
# Then:
#   scripts/preview-stack.sh db <REF>        link the project, push all migrations, load supabase/seed.sql, deploy edge functions
#   scripts/preview-stack.sh vercel <REF>    link/create the Vercel project, set env vars, deploy a preview, print the URL
#   scripts/preview-stack.sh webhook <REF> <PREVIEW_URL>   print the webhook URL to paste into Cashfree's sandbox dashboard
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."

CMD="${1:-}"; REF="${2:-}"
[[ -n "$REF" ]] || { sed -n '2,14p' "$0"; exit 1; }

case "$CMD" in
  db)
    supabase link --project-ref "$REF"
    supabase db push                                   # applies every migration in supabase/migrations
    # seed.sql is local-only by design; load it explicitly into the test project (never do this on production)
    DB_URL=$(supabase db url 2>/dev/null || true)
    if [[ -n "$DB_URL" ]]; then
      docker run --rm -i postgres:17 psql "$DB_URL" -v ON_ERROR_STOP=1 < supabase/seed.sql
    else
      echo "Could not resolve the DB URL automatically; run: psql '<connection string from dashboard>' -f supabase/seed.sql"
    fi
    supabase functions deploy --project-ref "$REF"     # all functions, verify_jwt per config.toml
    echo; echo "Project API URL:  https://$REF.supabase.co"
    echo "Anon key:          supabase projects api-keys --project-ref $REF"
    ;;
  vercel)
    ANON=$(supabase projects api-keys --project-ref "$REF" -o json | python3 -c "import sys,json; ks=json.load(sys.stdin); print(next(k['api_key'] for k in ks if k['name'] in ('anon','publishable')))")
    vercel link --yes --project pinkd-e2e-test
    for ENV in preview production; do
      printf '%s' "https://$REF.supabase.co" | vercel env add VITE_SUPABASE_URL "$ENV" --force >/dev/null
      printf '%s' "$ANON"                    | vercel env add VITE_SUPABASE_PUBLISHABLE_KEY "$ENV" --force >/dev/null
      printf '%s' "https://$REF.supabase.co" | vercel env add SUPABASE_URL "$ENV" --force >/dev/null
      printf '%s' "$ANON"                    | vercel env add SUPABASE_ANON_KEY "$ENV" --force >/dev/null
    done
    vercel deploy --yes 2>&1 | tee /tmp/vercel-deploy.log | tail -3
    URL=$(grep -Eo 'https://[a-z0-9.-]+\.vercel\.app' /tmp/vercel-deploy.log | tail -1)
    echo; echo "Preview URL: $URL"
    echo "Check:  curl -s $URL/api/party-status | head -c 300"
    ;;
  webhook)
    URL="${3:?usage: webhook <REF> <PREVIEW_URL>}"
    echo "Cashfree sandbox dashboard → Developers → Webhooks → add:"
    echo "  https://$REF.supabase.co/functions/v1/event-payment-webhook"
    echo "Events: PAYMENT_SUCCESS_WEBHOOK, PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK"
    echo "Then set CASHFREE_WEBHOOK_SECRET if you configured one (else the client secret is used):"
    echo "  supabase secrets set CASHFREE_WEBHOOK_SECRET=... --project-ref $REF"
    echo "Site URL for return links: supabase secrets set SITE_URL=$URL --project-ref $REF"
    ;;
  *) sed -n '2,14p' "$0"; exit 1;;
esac
