import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  fetchCashfreeOrder,
  getSupabaseAdmin,
  jsonResponse,
  mapCashfreeOrderStatus,
} from "../_shared/cashfree.ts";
import { sendEventConfirmationEmail } from "../_shared/eventEmail.ts";
import { validateCheckoutToken } from "../_shared/eventCheckout.ts";
import { fetchRazorpayPayment, verifyRazorpayPaymentSignature } from "../_shared/razorpay.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const {
      provider,
      event_order_id,
      checkout_token,
      cashfree_order_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json();

    if (!event_order_id) {
      return jsonResponse({ error: "event_order_id is required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const { data: settings, error: settingsError } = await supabase
      .from("payment_gateway_settings")
      .select("razorpay_key_id")
      .eq("id", "event_bookings")
      .single();

    if (settingsError) {
      return jsonResponse({ error: "Payment gateway settings are not configured" }, 500);
    }

    const { data: order, error: orderError } = await supabase
      .from("event_orders")
      .select("id, cashfree_order_id, razorpay_order_id, checkout_token_hash, checkout_token_expires_at")
      .eq("id", event_order_id)
      .single();

    if (orderError || !order) {
      return jsonResponse({ error: "Event order not found" }, 404);
    }

    const tokenValid = await validateCheckoutToken({
      providedToken: checkout_token,
      expectedHash: order.checkout_token_hash,
      expiresAt: order.checkout_token_expires_at,
    });

    if (!tokenValid) {
      return jsonResponse({ error: "Checkout session expired. Please create the booking again." }, 401);
    }

    if (provider === "razorpay") {
      if (!razorpay_payment_id || !razorpay_signature) {
        return jsonResponse({ error: "Razorpay payment id and signature are required" }, 400);
      }

      const expectedOrderId = order.razorpay_order_id || razorpay_order_id;
      if (!expectedOrderId || expectedOrderId !== razorpay_order_id) {
        return jsonResponse({ error: "Razorpay order mismatch" }, 400);
      }

      const signatureValid = await verifyRazorpayPaymentSignature({
        razorpayOrderId: expectedOrderId,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      });

      if (!signatureValid) {
        return jsonResponse({ error: "Invalid Razorpay signature" }, 400);
      }

      const payment = await fetchRazorpayPayment(razorpay_payment_id, settings?.razorpay_key_id);
      const razorpayStatus = payment?.status || "signature_verified";
      const paymentStatus = razorpayStatus === "captured" ? "paid" : "pending";
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from("event_orders")
        .update({
          payment_provider: "razorpay",
          payment_status: paymentStatus,
          payment_reference: razorpay_payment_id,
          razorpay_order_id: expectedOrderId,
          razorpay_payment_id,
          razorpay_signature,
          razorpay_payment_status: razorpayStatus,
          razorpay_payment_response: payment,
          last_payment_verified_at: now,
          paid_at: paymentStatus === "paid" ? now : null,
        })
        .eq("id", order.id);

      if (updateError) throw updateError;

      const emailResult =
        paymentStatus === "paid" ? await sendEventConfirmationEmail(supabase, order.id) : { sent: false };

      return jsonResponse({
        provider: "razorpay",
        event_order_id: order.id,
        razorpay_order_id: expectedOrderId,
        razorpay_payment_status: razorpayStatus,
        payment_status: paymentStatus,
        confirmation_email_sent: emailResult.sent,
        confirmation_email_error: "error" in emailResult ? emailResult.error : null,
      });
    }

    const expectedCashfreeOrderId = order.cashfree_order_id || cashfree_order_id;
    if (!expectedCashfreeOrderId) {
      return jsonResponse({ error: "Cashfree order id is required" }, 400);
    }

    const cashfreeOrder = await fetchCashfreeOrder(expectedCashfreeOrderId);
    const orderStatus = cashfreeOrder?.order_status || null;
    const paymentStatus = mapCashfreeOrderStatus(orderStatus);
    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("event_orders")
      .update({
        payment_provider: "cashfree",
        payment_status: paymentStatus,
        payment_reference: expectedCashfreeOrderId,
        cashfree_order_status: orderStatus,
        cashfree_payment_status: orderStatus,
        cashfree_order_response: cashfreeOrder,
        last_payment_verified_at: now,
        paid_at: paymentStatus === "paid" ? now : null,
      })
      .eq("id", order.id);

    if (updateError) throw updateError;

    const emailResult =
      paymentStatus === "paid" ? await sendEventConfirmationEmail(supabase, order.id) : { sent: false };

    return jsonResponse({
      provider: "cashfree",
      event_order_id: order.id,
      cashfree_order_id: expectedCashfreeOrderId,
      cashfree_order_status: orderStatus,
      payment_status: paymentStatus,
      confirmation_email_sent: emailResult.sent,
      confirmation_email_error: "error" in emailResult ? emailResult.error : null,
    });
  } catch (error) {
    console.error("event-payment-verify failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Payment verification failed" }, 500);
  }
});
