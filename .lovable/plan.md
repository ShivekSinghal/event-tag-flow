# Bulk Create 10 Staff User Accounts

## Goal
Provision 10 user accounts in Supabase Auth with the provided emails/passwords, skip any that already exist, and return a per-user success/failure log.

## Approach
Use a one-time admin edge function that calls Supabase's Admin API (`auth.admin.createUser`). Passwords are hashed by Supabase Auth automatically (bcrypt). Profiles are auto-created by the existing `handle_new_user` trigger with default role `staff`.

Note: the existing `handle_new_user` function references `public.profiles` but the DB schema shows no trigger is currently attached. I'll verify and, if missing, attach the `on_auth_user_created` trigger so profile rows are created. If the trigger already runs server-side (managed elsewhere), the migration will be a no-op safe `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS` + recreate.

## Steps

1. **Migration** — ensure trigger exists:
   - `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`
   - `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();`

2. **Create edge function** `supabase/functions/bulk-create-users/index.ts`:
   - Protected: requires caller to be an authenticated admin (verify JWT, check `profiles.role = 'admin'` using service role client).
   - Accepts `{ users: [{ email, password }] }`.
   - For each user:
     - Check if email exists via `supabase.auth.admin.listUsers` (paginated lookup) or attempt create and catch duplicate error.
     - If exists → log `{ email, status: "skipped", reason: "already exists" }`.
     - Else call `supabase.auth.admin.createUser({ email, password, email_confirm: true })` → log success or failure.
   - Returns JSON `{ results: [...] }`.
   - Configure `verify_jwt = true` in `supabase/config.toml`.

3. **Invoke function once** from the chat (via `supabase--curl_edge_functions` after deployment) using an admin session JWT, passing the 10 users. Return the success/failure log to the user.

## Users to create (all default role `staff`)
- singhalshivek24@gmail.com
- priyanshiikamboj05@gmail.com
- khanduja.dhriti04@gmail.com
- divijamalhotra@gmail.com
- asthat2716@gmail.com
- tarun@hashtag.dance
- rubanimay01@gmail.com
- kritirao1209@gmail.com
- akash@bbuzz.digital
- food@hashtag.dance

## Security notes
- Service role key stays inside the edge function (`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`), never exposed to client.
- Function gated by admin role check so non-admins can't mass-create users.
- Passwords transmitted once over HTTPS to the function, then hashed by Supabase Auth. They will not be retrievable afterwards — share them with users via a secure channel and recommend they reset on first login.

## Deliverable
A log printed in chat like:
```
singhalshivek24@gmail.com  → created
priyanshiikamboj05@gmail.com → created
tarun@hashtag.dance        → skipped (already exists)
...
```
