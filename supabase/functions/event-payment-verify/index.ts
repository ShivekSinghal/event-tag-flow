import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  fetchCashfreeOrder,
  getSupabaseAdmin,
  jsonResponse,
  mapCashfreeOrderStatus,
} from "../_shared/cashfree.ts";
import { sendEventConfirmationEmail } from "../_shared/eventEmail.ts";
import { autoCreditCoinOrder } from "../_shared/coinCredit.ts";
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
      .select("razorpay_key_id, cashfree_mode")
      .eq("id", "event_bookings")
      .single();

    if (settingsError) {
      return jsonResponse({ error: "Payment gateway settings are not configured" }, 500);
    }

    const { data: order, error: orderError } = await supabase
      .from("event_orders")
      .select("id, payment_provider, payment_status, cashfree_order_id, razorpay_order_id, checkout_token_hash, checkout_token_expires_at, confirmation_email_sent_at, confirmation_email_error")
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

    if (["paid", "completed"].includes(order.payment_status)) {
      return jsonResponse({
        provider: order.payment_provider || provider || "cashfree",
        event_order_id: order.id,
        payment_status: "paid",
        confirmation_email_sent: Boolean(order.confirmation_email_sent_at),
        confirmation_email_error: order.confirmation_email_error,
      });
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

      const { data: updatedOrder, error: updateError } = await supabase
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
        .eq("id", order.id)
        .neq("payment_status", "paid")
        .neq("payment_status", "completed")
        .select("id")
        .maybeSingle();

      if (updateError) throw updateError;

      const creditResult =
        paymentStatus === "paid" && updatedOrder?.id
          ? await autoCreditCoinOrder(supabase, order.id)
          : { attempted: false, credited: 0, reason: null, error: null };
      const emailResult =
        paymentStatus === "paid" && updatedOrder?.id
          ? await sendEventConfirmationEmail(supabase, order.id)
          : { sent: false };
      const { data: finalOrder, error: finalOrderError } = await supabase
        .from("event_orders")
        .select("payment_status, confirmation_email_sent_at, confirmation_email_error")
        .eq("id", order.id)
        .single();

      if (finalOrderError) throw finalOrderError;

      return jsonResponse({
        provider: "razorpay",
        coins_credited: creditResult.credited,
        coins_credit_reason: creditResult.reason,
        event_order_id: order.id,
        razorpay_order_id: expectedOrderId,
        razorpay_payment_status: razorpayStatus,
        payment_status: finalOrder.payment_status,
        confirmation_email_sent: emailResult.sent || Boolean(finalOrder.confirmation_email_sent_at),
        confirmation_email_error:
          ("error" in emailResult ? emailResult.error : null) || finalOrder.confirmation_email_error,
      });
    }

    const expectedCashfreeOrderId = order.cashfree_order_id || cashfree_order_id;
    if (!expectedCashfreeOrderId) {
      return jsonResponse({ error: "Cashfree order id is required" }, 400);
    }

    const cashfreeOrder = await fetchCashfreeOrder(expectedCashfreeOrderId, settings?.cashfree_mode);
    const orderStatus = cashfreeOrder?.order_status || null;
    const paymentStatus = mapCashfreeOrderStatus(orderStatus);
    const now = new Date().toISOString();

    const { data: updatedOrder, error: updateError } = await supabase
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
      .eq("id", order.id)
      .neq("payment_status", "paid")
      .neq("payment_status", "completed")
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;

    const creditResult =
      paymentStatus === "paid" && updatedOrder?.id
        ? await autoCreditCoinOrder(supabase, order.id)
        : { attempted: false, credited: 0, reason: null, error: null };
    const emailResult =
      paymentStatus === "paid" && updatedOrder?.id
        ? await sendEventConfirmationEmail(supabase, order.id)
        : { sent: false };
    const { data: finalOrder, error: finalOrderError } = await supabase
      .from("event_orders")
      .select("payment_status, confirmation_email_sent_at, confirmation_email_error")
      .eq("id", order.id)
      .single();

    if (finalOrderError) throw finalOrderError;

    return jsonResponse({
      provider: "cashfree",
      coins_credited: creditResult.credited,
      coins_credit_reason: creditResult.reason,
      event_order_id: order.id,
      cashfree_order_id: expectedCashfreeOrderId,
      cashfree_order_status: orderStatus,
      payment_status: finalOrder.payment_status,
      confirmation_email_sent: emailResult.sent || Boolean(finalOrder.confirmation_email_sent_at),
      confirmation_email_error:
        ("error" in emailResult ? emailResult.error : null) || finalOrder.confirmation_email_error,
    });
  } catch (error) {
    console.error("event-payment-verify failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Payment verification failed" }, 500);
  }
});
