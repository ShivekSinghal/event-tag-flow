import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  getSupabaseAdmin,
  jsonResponse,
  mapCashfreeOrderStatus,
  verifyCashfreeSignature,
} from "../_shared/cashfree.ts";

function readCashfreeOrderId(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const order = data?.order as Record<string, unknown> | undefined;
  return String(order?.order_id || data?.order_id || payload.order_id || "");
}

function readCashfreeStatus(payload: Record<string, unknown>) {
  const data = payload.data as Record<string, unknown> | undefined;
  const order = data?.order as Record<string, unknown> | undefined;
  const payment = data?.payment as Record<string, unknown> | undefined;
  return String(payment?.payment_status || order?.order_status || data?.order_status || payload.order_status || "");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature") || "";
  const timestamp = req.headers.get("x-webhook-timestamp") || "";
  const secret = Deno.env.get("CASHFREE_WEBHOOK_SECRET") || Deno.env.get("CASHFREE_CLIENT_SECRET") || "";

  if (!signature || !timestamp || !secret) {
    return jsonResponse({ error: "Missing webhook signature configuration" }, 400);
  }

  const isValid = await verifyCashfreeSignature(rawBody, timestamp, signature, secret);
  if (!isValid) {
    return jsonResponse({ error: "Invalid webhook signature" }, 400);
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const cashfreeOrderId = readCashfreeOrderId(payload);
    const cashfreeStatus = readCashfreeStatus(payload);

    if (!cashfreeOrderId) {
      return jsonResponse({ error: "Webhook does not include order id" }, 400);
    }

    const paymentStatus = mapCashfreeOrderStatus(cashfreeStatus);
    const updatePayload: Record<string, unknown> = {
      payment_provider: "cashfree",
      payment_status: paymentStatus,
      cashfree_order_status: cashfreeStatus || null,
      cashfree_payment_status: cashfreeStatus || null,
      cashfree_order_response: payload,
      last_payment_verified_at: new Date().toISOString(),
    };

    if (paymentStatus === "paid") {
      updatePayload.paid_at = new Date().toISOString();
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("event_orders")
      .update(updatePayload)
      .eq("cashfree_order_id", cashfreeOrderId);

    if (error) {
      throw error;
    }

    return jsonResponse({ received: true });
  } catch (error) {
    console.error("cashfree-webhook failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Webhook processing failed" }, 500);
  }
});
