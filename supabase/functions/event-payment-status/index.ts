import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, getSupabaseAdmin } from "../_shared/cashfree.ts";
import { validateCheckoutToken } from "../_shared/eventCheckout.ts";

const responseHeaders = {
  ...corsHeaders,
  "Cache-Control": "no-store, private",
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

type OrderItem = {
  package_category: string;
  pax: number | null;
  quantity: number;
};

function requiresAttendeeForm(items: OrderItem[]) {
  const partyEntries = items.reduce((total, item) => {
    if (!["party", "package", "group"].includes(item.package_category)) return total;
    return total + Math.max(item.pax || 1, 1) * Math.max(item.quantity || 1, 1);
  }, 0);

  return partyEntries > 1;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: responseHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const { event_order_id, checkout_token } = await req.json();

    if (!event_order_id || !checkout_token) {
      return jsonResponse({ error: "event_order_id and checkout_token are required" }, 400);
    }

    const supabase = getSupabaseAdmin();
    const { data: order, error } = await supabase
      .from("event_orders")
      .select(`
        id,
        payment_status,
        payment_provider,
        confirmation_email_sent_at,
        checkout_token_hash,
        checkout_token_expires_at,
        event_order_items(package_category, pax, quantity)
      `)
      .eq("id", event_order_id)
      .single();

    if (error || !order) {
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

    const items = Array.isArray(order.event_order_items)
      ? (order.event_order_items as OrderItem[])
      : [];

    return jsonResponse({
      payment_status: order.payment_status,
      payment_provider: order.payment_provider,
      order_reference: order.id.slice(0, 8).toUpperCase(),
      confirmation_email_sent: Boolean(order.confirmation_email_sent_at),
      attendee_form_required: requiresAttendeeForm(items),
    });
  } catch (error) {
    console.error("event-payment-status failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Payment status could not be loaded" }, 500);
  }
});
