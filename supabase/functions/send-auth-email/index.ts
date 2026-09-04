import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const hookSecret = Deno.env.get("SUPABASE_AUTH_EXTERNAL_WEBHOOK_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature",
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

  console.log("=== WEBHOOK DEBUG START ===");
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log("Headers:", Object.fromEntries(req.headers.entries()));
  console.log("Hook Secret Configured:", !!hookSecret);
  
  try {
    const authData: AuthEmailData = await req.json();
    console.log("Received auth webhook data:", JSON.stringify(authData, null, 2));

    // Log the specific event type
    console.log("Email action type:", authData.email_data?.email_action_type);
    console.log("User email:", authData.user?.email);

    const { user, email_data } = authData;
    
    if (!email_data) {
      console.error("No email_data provided in webhook");
      return new Response("Missing email data", { status: 400 });
    }
    
    const { token, token_hash, redirect_to, email_action_type, site_url } = email_data;

    if (!user?.email) {
      console.error("No user email provided");
      return new Response("No user email", { status: 400 });
    }

    console.log("Processing email for:", {
      email: user.email,
      action: email_action_type,
      hasToken: !!token,
      hasTokenHash: !!token_hash,
      siteUrl: site_url
    });

    let subject = "";
    let htmlContent = "";

    switch (email_action_type) {
      case "signup":
        subject = "Confirm your Game POS account";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Welcome to Game POS!</h2>
            <p>Thank you for creating an account. Please confirm your email address by clicking the button below:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${site_url}/auth/confirm?token_hash=${token_hash}&type=email&redirect_to=${encodeURIComponent(redirect_to || site_url)}" 
                 style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
                Confirm Email Address
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="word-break: break-all; font-size: 12px; color: #888;">${site_url}/auth/confirm?token_hash=${token_hash}&type=email&redirect_to=${encodeURIComponent(redirect_to || site_url)}</p>
          </div>
        `;
        break;
      case "magiclink":
        subject = "Your Game POS sign-in link";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Sign in to Game POS</h2>
            <p>Click the button below to sign in to your Game POS account:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${site_url}/auth/confirm?token_hash=${token_hash}&type=magiclink&redirect_to=${encodeURIComponent(redirect_to || site_url)}" 
                 style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
                Sign In
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="word-break: break-all; font-size: 12px; color: #888;">${site_url}/auth/confirm?token_hash=${token_hash}&type=magiclink&redirect_to=${encodeURIComponent(redirect_to || site_url)}</p>
          </div>
        `;
        break;
      case "recovery":
        subject = "Reset your Game POS password";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>You requested to reset your password. Click the button below to reset it:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${site_url}/auth/confirm?token_hash=${token_hash}&type=recovery&redirect_to=${encodeURIComponent(redirect_to || site_url)}" 
                 style="background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
                Reset Password
              </a>
            </div>
          </div>
        `;
        break;
      case "invite":
        subject = "You've been invited to Game POS";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">You're Invited!</h2>
            <p>You've been invited to join Game POS. Click the button below to accept the invitation:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${site_url}/auth/confirm?token_hash=${token_hash}&type=invite&redirect_to=${encodeURIComponent(redirect_to || site_url)}" 
                 style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
                Accept Invitation
              </a>
            </div>
          </div>
        `;
        break;
      default:
        console.log(`Unhandled email action type: ${email_action_type}`);
        return new Response(JSON.stringify({ success: true, message: "No email needed for this action" }), { 
          status: 200, 
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }

    console.log(`Attempting to send ${email_action_type} email to ${user.email} with subject: ${subject}`);

    
    const emailResult = await resend.emails.send({
      from: "Pink'd <universal@hashtag.dance>",
      to: [user.email],
      subject: subject,
      html: htmlContent,
    });

    console.log("Email sent successfully:", JSON.stringify(emailResult, null, 2));
    console.log("=== WEBHOOK DEBUG END ===");

    return new Response(JSON.stringify({ success: true, result: emailResult }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: unknown) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    console.error("=== ERROR IN WEBHOOK ===");
    console.error("Error type:", normalizedError.constructor.name);
    console.error("Error message:", normalizedError.message);
    console.error("Error stack:", normalizedError.stack);
    console.error("========================");
    return new Response(
      JSON.stringify({ 
        error: normalizedError.message,
        type: normalizedError.constructor.name,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
