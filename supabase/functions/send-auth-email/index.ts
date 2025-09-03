import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const hookSecret = Deno.env.get("SUPABASE_AUTH_EXTERNAL_WEBHOOK_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuthEmailData {
  user: {
    id: string;
    email: string;
    email_confirmed_at?: string;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("Webhook received:", req.method, req.url);
  console.log("Headers:", Object.fromEntries(req.headers.entries()));

  try {
    // Verify webhook signature if secret is configured
    if (hookSecret) {
      const signature = req.headers.get("x-webhook-signature");
      if (!signature) {
        console.error("Missing webhook signature");
        return new Response("Unauthorized", { status: 401 });
      }
    }

    const authData: AuthEmailData = await req.json();
    console.log("Received auth webhook:", JSON.stringify(authData, null, 2));

    const { user, email_data } = authData;
    const { token, token_hash, redirect_to, email_action_type, site_url } = email_data;

    let subject = "";
    let htmlContent = "";

    switch (email_action_type) {
      case "signup":
        subject = "Confirm your Game POS account";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Welcome to Game POS!</h1>
            <p>Thanks for signing up! Please confirm your email address by clicking the link below:</p>
            <div style="margin: 30px 0;">
              <a href="${site_url}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${redirect_to}" 
                 style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Confirm Email Address
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">
              If you didn't create this account, you can safely ignore this email.
            </p>
          </div>
        `;
        break;

      case "recovery":
        subject = "Reset your Game POS password";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Reset Your Password</h1>
            <p>We received a request to reset your password. Click the link below to set a new password:</p>
            <div style="margin: 30px 0;">
              <a href="${site_url}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${redirect_to}" 
                 style="background-color: #DC2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">
              This link will expire in 24 hours. If you didn't request this, you can safely ignore this email.
            </p>
          </div>
        `;
        break;

      case "invite":
        subject = "You've been invited to Game POS";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">You're Invited!</h1>
            <p>You've been invited to join Game POS. Click the link below to accept the invitation:</p>
            <div style="margin: 30px 0;">
              <a href="${site_url}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${redirect_to}" 
                 style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Accept Invitation
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">
              If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </div>
        `;
        break;

      default:
        subject = "Game POS Email Verification";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #333;">Email Verification</h1>
            <p>Please verify your email address by clicking the link below:</p>
            <div style="margin: 30px 0;">
              <a href="${site_url}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${redirect_to}" 
                 style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Verify Email
              </a>
            </div>
          </div>
        `;
    }

    const emailResponse = await resend.emails.send({
      from: "Game POS <onboarding@resend.dev>",
      to: [user.email],
      subject: subject,
      html: htmlContent,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error in send-auth-email function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);