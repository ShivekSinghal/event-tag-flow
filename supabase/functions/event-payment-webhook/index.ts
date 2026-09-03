import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  getSupabaseAdmin,
  jsonResponse,
  mapCashfreeOrderStatus,
  verifyCashfreeSignature,
} from "../_shared/cashfree.ts";
import { sendEventConfirmationEmail } from "../_shared/eventEmail.ts";
import { autoCreditCoinOrder } from "../_shared/coinCredit.ts";
import { verifyRazorpayWebhookSignature } from "../_shared/razorpay.ts";

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

function readRazorpayPayment(payload: Record<string, unknown>) {
  const paymentEntity = (((payload.payload as Record<string, unknown> | undefined)?.payment as Record<string, unknown> | undefined)
    ?.entity || {}) as Record<string, unknown>;
  const orderEntity = (((payload.payload as Record<string, unknown> | undefined)?.order as Record<string, unknown> | undefined)
    ?.entity || {}) as Record<string, unknown>;

  return {
    paymentId: String(paymentEntity.id || ""),
    orderId: String(paymentEntity.order_id || orderEntity.id || ""),
    status: String(paymentEntity.status || ""),
    rawPayment: paymentEntity,
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const gateway = new URL(req.url).searchParams.get("gateway");
  const rawBody = await req.text();

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const supabase = getSupabaseAdmin();

    if (gateway === "razorpay") {
      const signature = req.headers.get("x-razorpay-signature") || "";
      if (!signature || !(await verifyRazorpayWebhookSignature(rawBody, signature))) {
        return jsonResponse({ error: "Invalid Razorpay webhook signature" }, 400);
      }

      const payment = readRazorpayPayment(payload);
      if (!payment.orderId) {
        return jsonResponse({ error: "Webhook does not include Razorpay order id" }, 400);
      }

      const paymentStatus = payment.status === "captured" ? "paid" : payment.status === "failed" ? "failed" : "pending";
      const now = new Date().toISOString();
      const { data: updatedOrder, error } = await supabase
        .from("event_orders")
        .update({
          payment_provider: "razorpay",
          payment_status: paymentStatus,
          payment_reference: payment.paymentId || payment.orderId,
          razorpay_payment_id: payment.paymentId || null,
          razorpay_payment_status: payment.status || null,
          razorpay_payment_response: payload,
          last_payment_verified_at: now,
          paid_at: paymentStatus === "paid" ? now : null,
        })
        .eq("razorpay_order_id", payment.orderId)
        .select("id")
        .maybeSingle();

      if (error) throw error;

      const creditResult =
        paymentStatus === "paid" && updatedOrder?.id
          ? await autoCreditCoinOrder(supabase, updatedOrder.id)
          : { attempted: false, credited: 0, reason: null, error: null };

      const emailResult =
        paymentStatus === "paid" && updatedOrder?.id
          ? await sendEventConfirmationEmail(supabase, updatedOrder.id)
          : { sent: false };

      return jsonResponse({
        received: true,
        coins_credited: creditResult.credited,
        confirmation_email_sent: emailResult.sent,
        confirmation_email_error: "error" in emailResult ? emailResult.error : null,
      });
    }

    const signature = req.headers.get("x-webhook-signature") || "";
    const timestamp = req.headers.get("x-webhook-timestamp") || "";
    const secret = Deno.env.get("CASHFREE_WEBHOOK_SECRET") || Deno.env.get("CASHFREE_CLIENT_SECRET") || "";

    if (!signature || !timestamp || !secret) {
      return jsonResponse({ error: "Missing Cashfree webhook signature configuration" }, 400);
    }

    if (!(await verifyCashfreeSignature(rawBody, timestamp, signature, secret))) {
      return jsonResponse({ error: "Invalid Cashfree webhook signature" }, 400);
    }

    const cashfreeOrderId = readCashfreeOrderId(payload);
    const cashfreeStatus = readCashfreeStatus(payload);

    if (!cashfreeOrderId) {
      return jsonResponse({ error: "Webhook does not include Cashfree order id" }, 400);
    }

    const paymentStatus = mapCashfreeOrderStatus(cashfreeStatus);
    const now = new Date().toISOString();
    const { data: updatedOrder, error } = await supabase
      .from("event_orders")
      .update({
        payment_provider: "cashfree",
        payment_status: paymentStatus,
        cashfree_order_status: cashfreeStatus || null,
        cashfree_payment_status: cashfreeStatus || null,
        cashfree_order_response: payload,
        last_payment_verified_at: now,
        paid_at: paymentStatus === "paid" ? now : null,
      })
      .eq("cashfree_order_id", cashfreeOrderId)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    const creditResult =
      paymentStatus === "paid" && updatedOrder?.id
        ? await autoCreditCoinOrder(supabase, updatedOrder.id)
        : { attempted: false, credited: 0, reason: null, error: null };

    const emailResult =
      paymentStatus === "paid" && updatedOrder?.id
        ? await sendEventConfirmationEmail(supabase, updatedOrder.id)
        : { sent: false };

    return jsonResponse({
      received: true,
      coins_credited: creditResult.credited,
      confirmation_email_sent: emailResult.sent,
      confirmation_email_error: "error" in emailResult ? emailResult.error : null,
    });
  } catch (error) {
    console.error("event-payment-webhook failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Webhook processing failed" }, 500);
  }
});
