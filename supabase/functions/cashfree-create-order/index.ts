import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  CASHFREE_API_VERSION,
  corsHeaders,
  getCashfreeConfig,
  getSiteUrl,
  getSupabaseAdmin,
  jsonResponse,
  makeCashfreeOrderId,
} from "../_shared/cashfree.ts";

const BRAND_NAME = "pinkd";
const BRAND_COLOR = "#ff007f";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { event_order_id } = await req.json();

    if (!event_order_id || typeof event_order_id !== "string") {
      return jsonResponse({ error: "event_order_id is required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const { data: order, error: orderError } = await supabase
      .from("event_orders")
      .select("id, customer_name, customer_phone, customer_email, total_amount_inr, payment_status, cashfree_order_id, cashfree_payment_session_id")
      .eq("id", event_order_id)
      .single();

    if (orderError || !order) {
      return jsonResponse({ error: "Event order not found" }, 404);
    }

    if (["paid", "completed"].includes(order.payment_status)) {
      return jsonResponse({ error: "This order is already paid" }, 409);
    }

    const config = getCashfreeConfig();
    const cashfreeOrderId = order.cashfree_order_id || makeCashfreeOrderId(order.id);

    if (order.cashfree_payment_session_id) {
      return jsonResponse({
        event_order_id: order.id,
        cashfree_order_id: cashfreeOrderId,
        payment_session_id: order.cashfree_payment_session_id,
        mode: config.mode,
      });
    }

    const siteUrl = getSiteUrl(req);
    const response = await fetch(`${config.baseUrl}/orders`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "x-api-version": CASHFREE_API_VERSION,
        "x-client-id": config.clientId,
        "x-client-secret": config.clientSecret,
      },
      body: JSON.stringify({
        order_id: cashfreeOrderId,
        order_amount: Number(order.total_amount_inr),
        order_currency: "INR",
        customer_details: {
          customer_id: order.id,
          customer_name: order.customer_name,
          customer_email: order.customer_email,
          customer_phone: order.customer_phone,
        },
        order_meta: {
          return_url: `${siteUrl}/?event_order_id=${order.id}&cashfree_order_id=${cashfreeOrderId}`,
        },
        order_note: "pinkd event booking",
        order_tags: {
          brand_name: BRAND_NAME,
          brand_color: BRAND_COLOR,
          checkout_context: "pinkd event booking",
        },
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message = payload?.message || payload?.error_description || payload?.error || "Cashfree order creation failed";
      return jsonResponse({ error: message, details: payload }, response.status);
    }

    const { error: updateError } = await supabase
      .from("event_orders")
      .update({
        payment_provider: "cashfree",
        payment_status: "pending",
        payment_reference: cashfreeOrderId,
        cashfree_order_id: cashfreeOrderId,
        cashfree_cf_order_id: payload?.cf_order_id ? String(payload.cf_order_id) : null,
        cashfree_payment_session_id: payload?.payment_session_id || null,
        cashfree_order_status: payload?.order_status || null,
        cashfree_order_response: payload,
      })
      .eq("id", order.id);

    if (updateError) {
      throw updateError;
    }

    return jsonResponse({
      event_order_id: order.id,
      cashfree_order_id: cashfreeOrderId,
      payment_session_id: payload?.payment_session_id,
      mode: config.mode,
    });
  } catch (error) {
    console.error("cashfree-create-order failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Cashfree setup failed" }, 500);
  }
});
