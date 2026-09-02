import { createClient } from "https://esm.sh/@supabase/supabase-js@2.56.0";

export const CASHFREE_API_VERSION = "2025-01-01";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-signature, x-webhook-timestamp, x-webhook-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function getSupabaseAdmin() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not configured");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function getCashfreeConfig() {
  const clientId = Deno.env.get("CASHFREE_CLIENT_ID");
  const clientSecret = Deno.env.get("CASHFREE_CLIENT_SECRET");
  const env = (Deno.env.get("CASHFREE_ENV") || "sandbox").toLowerCase();
  const mode = env === "production" ? "production" : "sandbox";

  if (!clientId || !clientSecret) {
    throw new Error("Cashfree credentials are not configured");
  }

  return {
    clientId,
    clientSecret,
    mode,
    baseUrl: mode === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
  };
}

export function getSiteUrl(req: Request) {
  const configuredUrl = Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_SITE_URL") || Deno.env.get("CASHFREE_RETURN_URL");
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const origin = req.headers.get("origin");
  return origin || new URL(req.url).origin;
}

export function makeCashfreeOrderId(eventOrderId: string) {
  return `pinkd_${eventOrderId.replace(/-/g, "").slice(0, 26)}`;
}

export function mapCashfreeOrderStatus(orderStatus: string | null | undefined) {
  const status = (orderStatus || "").toUpperCase();

  if (status === "PAID") return "paid";
  if (status === "EXPIRED") return "failed";
  if (status === "TERMINATED" || status === "CANCELLED") return "cancelled";
  return "pending";
}

export async function fetchCashfreeOrder(cashfreeOrderId: string) {
  const config = getCashfreeConfig();
  const response = await fetch(`${config.baseUrl}/orders/${encodeURIComponent(cashfreeOrderId)}`, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "x-api-version": CASHFREE_API_VERSION,
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload?.message || payload?.error_description || payload?.error || "Cashfree order verification failed";
    throw new Error(message);
  }

  return payload;
}

export async function verifyCashfreeSignature(rawBody: string, timestamp: string, signature: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}${rawBody}`));
  const computedSignature = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return timingSafeEqual(computedSignature, signature);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
