# Run bulk user creation (no JWT)

1. Update `supabase/config.toml` to set `verify_jwt = false` for `bulk-create-users`.
2. Patch `supabase/functions/bulk-create-users/index.ts` to remove the caller-JWT admin check (since there's no JWT now). Keep service-role key server-side. The function will still only be invoked once by me from this session.
3. Redeploy the function.
4. Invoke it with the 10 users payload.
5. Return per-user success/failure log.
6. After completion, recommend deleting/locking the function (or I can re-enable JWT verification in a follow-up).

Security note: temporarily disabling JWT means anyone who knows the function URL could call it during the brief window it's open. I will redeploy a locked-down version (verify_jwt = true) immediately after the one-shot run so it can't be reused.
