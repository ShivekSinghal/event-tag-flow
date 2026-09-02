import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  corsHeaders,
  fetchCashfreeOrder,
  getSupabaseAdmin,
  jsonResponse,
  mapCashfreeOrderStatus,
} from "../_shared/cashfree.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { event_order_id, cashfree_order_id } = await req.json();

    if (!event_order_id && !cashfree_order_id) {
      return jsonResponse({ error: "event_order_id or cashfree_order_id is required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const query = supabase
      .from("event_orders")
      .select("id, cashfree_order_id, payment_status");

    const { data: order, error: orderError } = await (
      event_order_id ? query.eq("id", event_order_id) : query.eq("cashfree_order_id", cashfree_order_id)
    ).single();

    if (orderError || !order?.cashfree_order_id) {
      return jsonResponse({ error: "Cashfree event order not found" }, 404);
    }

    const cashfreeOrder = await fetchCashfreeOrder(order.cashfree_order_id);
    const orderStatus = cashfreeOrder?.order_status || null;
    const paymentStatus = mapCashfreeOrderStatus(orderStatus);

    const updatePayload: Record<string, unknown> = {
      payment_provider: "cashfree",
      payment_status: paymentStatus,
      payment_reference: order.cashfree_order_id,
      cashfree_order_status: orderStatus,
      cashfree_payment_status: orderStatus,
      cashfree_order_response: cashfreeOrder,
      last_payment_verified_at: new Date().toISOString(),
    };

    if (paymentStatus === "paid") {
      updatePayload.paid_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from("event_orders")
      .update(updatePayload)
      .eq("id", order.id);

    if (updateError) {
      throw updateError;
    }

    return jsonResponse({
      event_order_id: order.id,
      cashfree_order_id: order.cashfree_order_id,
      cashfree_order_status: orderStatus,
      payment_status: paymentStatus,
    });
  } catch (error) {
    console.error("cashfree-verify-order failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Cashfree verification failed" }, 500);
  }
});
