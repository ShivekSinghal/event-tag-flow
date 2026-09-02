import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, getSupabaseAdmin, jsonResponse } from "../_shared/cashfree.ts";
import { sendEventConfirmationEmail } from "../_shared/eventEmail.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    if (!jwt) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabase = getSupabaseAdmin();
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);

    if (userError || !userData.user) {
      return jsonResponse({ error: "Invalid authorization" }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .single();

    if (profileError || profile?.role !== "admin") {
      return jsonResponse({ error: "Only admins can send confirmation emails" }, 403);
    }

    const { event_order_id } = await req.json();
    if (!event_order_id || typeof event_order_id !== "string") {
      return jsonResponse({ error: "event_order_id is required" }, 400);
    }

    const { data: order, error: orderError } = await supabase
      .from("event_orders")
      .select("id, payment_status")
      .eq("id", event_order_id)
      .single();

    if (orderError || !order) {
      return jsonResponse({ error: "Event order not found" }, 404);
    }

    if (!["paid", "completed"].includes(order.payment_status)) {
      return jsonResponse({ error: "Confirmation email can only be sent after payment is successful" }, 409);
    }

    const emailResult = await sendEventConfirmationEmail(supabase, order.id);
    return jsonResponse({
      event_order_id: order.id,
      confirmation_email_sent: emailResult.sent,
      confirmation_email_error: "error" in emailResult ? emailResult.error : null,
    });
  } catch (error) {
    console.error("event-confirmation-email failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Confirmation email failed" }, 500);
  }
});
