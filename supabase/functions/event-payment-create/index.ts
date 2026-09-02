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
import { validateCheckoutToken } from "../_shared/eventCheckout.ts";
import { createRazorpayOrder, getRazorpayConfig } from "../_shared/razorpay.ts";

const BRAND_NAME = "PINK'D";
const BRAND_COLOR = "#ff007f";

type EventOrderItem = {
  package_category: string;
  package_name: string;
  unit_price_inr: number | string;
  quantity: number;
  line_total_inr: number | string;
  selected_time_slots?: unknown;
};

function toNumber(value: number | string) {
  return typeof value === "number" ? value : Number(value || 0);
}

function getSelectedSlotSummary(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return "";
  return value.map((slot) => String(slot)).join(", ");
}

function makeOrderItemSummary(items: EventOrderItem[] = []) {
  return items
    .map((item) => {
      const slotSummary = getSelectedSlotSummary(item.selected_time_slots);
      const base = `${item.quantity} x ${item.package_name} @ INR ${toNumber(item.unit_price_inr).toFixed(2)} = INR ${toNumber(item.line_total_inr).toFixed(2)}`;
      return slotSummary ? `${base} | slots: ${slotSummary}` : base;
    })
    .join("; ");
}

function makeCoinSummary(items: EventOrderItem[] = []) {
  return items
    .filter((item) => item.package_category === "coins")
    .map((item) => `${item.quantity} x ${item.package_name} for INR ${toNumber(item.line_total_inr).toFixed(2)}`)
    .join("; ");
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { event_order_id, checkout_token } = await req.json();

    if (!event_order_id || typeof event_order_id !== "string") {
      return jsonResponse({ error: "event_order_id is required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const { data: settings, error: settingsError } = await supabase
      .from("payment_gateway_settings")
      .select("active_provider, razorpay_key_id, cashfree_mode")
      .eq("id", "event_bookings")
      .single();

    if (settingsError || !settings) {
      return jsonResponse({ error: "Payment gateway settings are not configured" }, 500);
    }

    const { data: order, error: orderError } = await supabase
      .from("event_orders")
      .select("id, customer_name, customer_phone, customer_email, customer_studio, total_amount_inr, payment_status, cashfree_order_id, cashfree_payment_session_id, razorpay_order_id, razorpay_order_response, checkout_token_hash, checkout_token_expires_at, event_order_items(package_category, package_name, unit_price_inr, quantity, line_total_inr, selected_time_slots)")
      .eq("id", event_order_id)
      .single();

    if (orderError || !order) {
      return jsonResponse({ error: "Event order not found" }, 404);
    }

    if (["paid", "completed"].includes(order.payment_status)) {
      return jsonResponse({ error: "This order is already paid" }, 409);
    }

    const tokenValid = await validateCheckoutToken({
      providedToken: checkout_token,
      expectedHash: order.checkout_token_hash,
      expiresAt: order.checkout_token_expires_at,
    });

    if (!tokenValid) {
      return jsonResponse({ error: "Checkout session expired. Please create the booking again." }, 401);
    }

    const orderItems = Array.isArray(order.event_order_items) ? order.event_order_items as EventOrderItem[] : [];
    const itemsSummary = makeOrderItemSummary(orderItems);
    const coinSummary = makeCoinSummary(orderItems);

    if (settings.active_provider === "razorpay") {
      if (order.razorpay_order_id && order.razorpay_order_response) {
        const { keyId } = getRazorpayConfig(settings.razorpay_key_id);
        return jsonResponse({
          provider: "razorpay",
          event_order_id: order.id,
          razorpay_order_id: order.razorpay_order_id,
          key_id: keyId,
          amount_paise: Math.round(Number(order.total_amount_inr) * 100),
          currency: "INR",
          customer: {
            name: order.customer_name,
            email: order.customer_email,
            phone: order.customer_phone,
            studio: order.customer_studio || "",
          },
        });
      }

      const razorpayOrder = await createRazorpayOrder({
        eventOrderId: order.id,
        amountInr: Number(order.total_amount_inr),
        customerName: order.customer_name,
        customerEmail: order.customer_email,
        customerPhone: order.customer_phone,
        customerStudio: order.customer_studio,
        itemsSummary,
        coinSummary,
        keyId: settings.razorpay_key_id,
      });

      const { error: updateError } = await supabase
        .from("event_orders")
        .update({
          payment_provider: "razorpay",
          payment_status: "pending",
          payment_reference: razorpayOrder.payload.id,
          razorpay_order_id: razorpayOrder.payload.id,
          razorpay_order_response: razorpayOrder.payload,
        })
        .eq("id", order.id);

      if (updateError) throw updateError;

      return jsonResponse({
        provider: "razorpay",
        event_order_id: order.id,
        razorpay_order_id: razorpayOrder.payload.id,
        key_id: razorpayOrder.keyId,
        amount_paise: razorpayOrder.amountPaise,
        currency: "INR",
        customer: {
          name: order.customer_name,
          email: order.customer_email,
          phone: order.customer_phone,
          studio: order.customer_studio || "",
        },
      });
    }

    const config = getCashfreeConfig(settings.cashfree_mode);
    const cashfreeOrderId = order.cashfree_order_id || makeCashfreeOrderId(order.id);

    if (order.cashfree_payment_session_id) {
      return jsonResponse({
        provider: "cashfree",
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
          customer_studio: order.customer_studio || "",
        },
        order_meta: {
          return_url: `${siteUrl}/?event_order_id=${order.id}&cashfree_order_id=${cashfreeOrderId}`,
        },
        order_note: "PINK'D event booking",
        order_tags: {
          brand_name: BRAND_NAME,
          brand_color: BRAND_COLOR,
          checkout_context: "PINK'D event booking",
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

    if (updateError) throw updateError;

    return jsonResponse({
      provider: "cashfree",
      event_order_id: order.id,
      cashfree_order_id: cashfreeOrderId,
      payment_session_id: payload?.payment_session_id,
      mode: config.mode,
    });
  } catch (error) {
    console.error("event-payment-create failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Payment setup failed" }, 500);
  }
});
