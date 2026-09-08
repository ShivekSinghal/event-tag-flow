import { Webhook } from "npm:standardwebhooks@1.1.1";
import { createAuthEmailHandler } from "./handler.ts";

const secret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
const apiKey = Deno.env.get("RESEND_API_KEY");
const sender = Deno.env.get("AUTH_EMAIL_FROM") || Deno.env.get("EVENT_CONFIRMATION_EMAIL_FROM");
const webhook = secret ? new Webhook(secret.replace(/^v1,/, "")) : null;

Deno.serve(createAuthEmailHandler({
  configured: Boolean(webhook && apiKey && sender && !sender.includes("@resend.dev")),
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
  siteUrl: "https://pinkd.hashtag.dance",
  verify: (body, headers) => {
    if (!webhook) throw new Error("Email hook unavailable");
    return webhook.verify(body, headers);
  },
  send: async (message, idempotencyKey) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: sender, ...message }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!response.ok || typeof result.id !== "string") throw new Error("Email provider rejected delivery");
  },
}));
