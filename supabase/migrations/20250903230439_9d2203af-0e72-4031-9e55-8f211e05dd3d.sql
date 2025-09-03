-- Remove the auth webhook configuration to use Supabase's default emails
-- This will make authentication emails work immediately without requiring Resend setup

-- Note: This removes the custom email webhook, so Supabase will send default emails
-- The custom send-auth-email function will no longer be called