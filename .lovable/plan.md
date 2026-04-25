# Add Password Reset Flow

Let users reset their own password from the login page via a "Forgot password?" link that emails a reset link, which leads to a page where they set a new password.

## 1. Update `src/pages/Auth.tsx`
- Add a **"Forgot password?"** link below the Sign In password field.
- Add a new `forgot` view (toggled via local state, not a tab) that shows:
  - Email input
  - "Send reset link" button → calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${window.location.origin}/reset-password\` })`
  - Success toast: "Check your email for a reset link"
  - "Back to sign in" link
- Keep existing Sign In / Sign Up tabs untouched.

## 2. Create `src/pages/ResetPassword.tsx` (new)
- Public page (no auth guard).
- On mount, check `window.location.hash` for `type=recovery` — Supabase auto-creates a recovery session from the link. Listen via `supabase.auth.onAuthStateChange` for the `PASSWORD_RECOVERY` event.
- Show form with **New password** + **Confirm password** fields (with show/hide toggle, matching Auth.tsx style).
- On submit: `supabase.auth.updateUser({ password })` → toast success → sign out → navigate to `/auth`.
- Handle the case where the recovery token is missing/expired (show error + link back to "Forgot password").

## 3. Register the route in `src/App.tsx`
- Add `<Route path="/reset-password" element={<ResetPassword />} />` **outside** the `ProtectedRoute` wrapper (it must be public so users arriving from email aren't redirected).

## 4. Email delivery
- Supabase's default recovery email template will be used — no custom email setup needed. The reset link will redirect to `https://nfc.hashtag.dance/reset-password` (or the preview URL during testing).
- **Action required from you in the Supabase dashboard:** ensure `https://nfc.hashtag.dance/reset-password` and your preview URL are listed under **Auth → URL Configuration → Redirect URLs**. Otherwise Supabase will block the redirect. I'll remind you with a direct link after implementation.

## Out of scope
- No custom branded email templates (default Supabase recovery email is fine for now — can be added later if you want).
- No changes to existing roles, profiles, or admin user management.
