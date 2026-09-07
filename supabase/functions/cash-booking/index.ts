import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.56.0";
import { corsHeaders, getSupabaseAdmin, jsonResponse } from "../_shared/cashfree.ts";
import { renderTicketEmail, type EventOrder } from "../_shared/eventEmail.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALERT_TO = ["manas210890@gmail.com", "ayushi.pathania@gmail.com"];
const requiredSecrets = ["RESEND_API_KEY", "EVENT_CONFIRMATION_EMAIL_FROM", "CASH_BOOKING_CODE_SECRET", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
type Message = { from: string; to: string[]; subject: string; html: string };
type Job = { id: string; kind: string; generation_id: string; status: string; first_attempt_at: string | null; payload: Message | null };
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function hmac(value: string) {
  const secret = Deno.env.get("CASH_BOOKING_CODE_SECRET");
  if (!secret || secret.length < 32) throw new Error("Cash code secret is not configured");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

// Regeneration with the same operation UUID recovers an email after a lost response.
async function codeFor(order: string, operation: string) {
  return (Number.parseInt((await hmac(`cash-code:${order}:${operation}`)).slice(0, 12), 16) % 1_000_000).toString().padStart(6, "0");
}

async function deliver(admin: SupabaseClient, orderId: string) {
  const { data: jobs, error: jobsError } = await admin.from("cash_notifications").select("*").eq("order_id", orderId).in("status", ["pending", "error", "sending"]);
  if (jobsError) throw new Error("Cannot load notification queue");
  const { data: order, error: orderError } = await admin.from("event_orders").select("*,event_order_items(*)").eq("id", orderId).single();
  const { data: conf } = await admin.from("cash_booking_confirmations").select("*").eq("order_id", orderId).single();
  if (orderError || !order || !conf) throw new Error("Cannot load cash receipt");
  const outcomes: { kind: string; status: string }[] = [];
  for (const queued of (jobs || []) as Job[]) {
    const claim = crypto.randomUUID();
    const { data: acquired, error: claimError } = await admin.rpc("claim_cash_notification", { p_id: queued.id, p_claim: claim });
    if (claimError) throw new Error("Cannot claim notification");
    if (!acquired) continue;
    const job = acquired as Job;
    try {
      // Resend retains idempotency keys for 24h. Never blindly resend an uncertain older request.
      if (job.first_attempt_at && Date.now() - Date.parse(job.first_attempt_at) >= 23 * 3600_000) throw new Error("manual_review");
      if (job.kind === "code" && (conf.code_operation_id !== job.generation_id || conf.cancelled_at || conf.confirmed_at || Date.parse(conf.code_expires_at) <= Date.now())) {
        await admin.from("cash_notifications").update({ status: "obsolete" }).eq("id", job.id).eq("claim_id", claim);
        continue;
      }
      if (job.kind !== "code" && !["paid", "completed"].includes(order.payment_status)) throw new Error("Receipt is not confirmed");
      const ref = order.id.slice(0, 8).toUpperCase();
      const amount = `INR ${Number(order.total_amount_inr).toLocaleString("en-IN")}`;
      const from = Deno.env.get("EVENT_CONFIRMATION_EMAIL_FROM")!;
      let message = job.payload;
      if (!message) {
        if (job.kind === "code") {
          const code = await codeFor(orderId, job.generation_id);
          message = { from, to: [order.customer_email], subject: `Pink'd cash confirmation - ${ref}`, html: `<p>Hi ${escape(order.customer_name)},</p><p>Confirm ${amount} in cash at ${escape(conf.studio)} for booking ${ref}.</p><h1>${code}</h1><p>Valid until ${escape(new Date(conf.code_expires_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))} IST. Read this code to the studio manager only after checking the amount. Your booking is not paid until the code is accepted.</p>` };
        } else if (job.kind === "confirmation") {
          message = { from, to: [order.customer_email], subject: `Pink'd booking confirmed - ${ref}`, html: renderTicketEmail(order as EventOrder, 0) };
        } else {
          const { data: manager } = await admin.from("profiles").select("full_name,email").eq("id", conf.confirmed_by).single();
          const items = (order.event_order_items as { package_name: string; quantity: number }[]).map(i => `${i.package_name} x${i.quantity}`).join(", ");
          message = { from, to: ALERT_TO, subject: `Cash booking ${ref} - ${amount} - ${conf.studio}`, html: `<p>${escape(order.customer_name)} paid ${amount} for ${escape(items)}.</p><p>Ref ${ref}; collected at ${escape(conf.studio)} by ${escape(manager?.full_name || manager?.email || conf.confirmed_by)} on ${escape(conf.confirmed_at)}. Customer home studio: ${escape(order.customer_studio || "Not specified")}.</p>` };
        }
        // Codes are regenerated, not stored in notification bodies or logs.
        if (job.kind !== "code") {
          const { error } = await admin.from("cash_notifications").update({ payload: message }).eq("id", job.id).eq("claim_id", claim);
          if (error) throw new Error("Cannot freeze receipt email");
        }
      }
      const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": `cash/${job.id}` }, body: JSON.stringify(message), signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!response.ok || typeof result.id !== "string") throw new Error("delivery_unconfirmed");
      const { error } = await admin.from("cash_notifications").update({ status: "sent", sent_at: new Date().toISOString(), provider_id: result.id, error: null }).eq("id", job.id).eq("claim_id", claim).eq("status", "sending");
      if (error) throw new Error("delivery_unconfirmed");
      if (job.kind === "confirmation") await admin.from("event_orders").update({ confirmation_email_sent_at: new Date().toISOString(), confirmation_email_id: result.id, confirmation_email_error: null }).eq("id", orderId);
      outcomes.push({ kind: job.kind, status: "sent" });
    } catch (error) {
      const status = error instanceof Error && error.message === "manual_review" ? "Delivery uncertain: review Resend before resending" : "Delivery not confirmed; retry notifications";
      await admin.from("cash_notifications").update({ status: "error", error: status }).eq("id", job.id).eq("claim_id", claim).eq("status", "sending");
      outcomes.push({ kind: job.kind, status: "error" });
    }
  }
  return outcomes;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const configured = requiredSecrets.every(k => Boolean(Deno.env.get(k))) && (Deno.env.get("CASH_BOOKING_CODE_SECRET")?.length || 0) >= 32;
  if (req.method === "GET") return jsonResponse({ ready: configured, cash_version: 1 }, configured ? 200 : 503);
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!configured) return jsonResponse({ error: "Cash desk email configuration is incomplete" }, 503);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Sign in to Cash Desk" }, 401);
    const body = await req.json();
    const { action, order_id: orderId, operation_id: operationId } = body;
    if (!UUID.test(orderId || "") || !UUID.test(operationId || "") || !["request_code", "confirm", "revive", "cancel", "retry_notifications", "check_operation"].includes(action)) return jsonResponse({ error: "Invalid cash action" }, 400);
    const admin = getSupabaseAdmin();
    const { data: conf } = await admin.from("cash_booking_confirmations").select("studio").eq("order_id", orderId).maybeSingle();
    const { data: allowed } = await admin.rpc("cash_actor_allowed", { p_actor: user.id, p_studio: conf?.studio || "" });
    if (!allowed) return jsonResponse({ error: "Cash desk access denied for this studio" }, 403);
    if (action === "check_operation") {
      const { data, error } = await admin.from("cash_desk_operations").select("actor_id,request,result").eq("operation_id", operationId).maybeSingle();
      if (error) throw new Error("Cannot recover operation");
      if (data && (data.actor_id !== user.id || data.request.order_id !== orderId)) return jsonResponse({ error: "Operation identity mismatch" }, 403);
      return jsonResponse(data?.result || { status: "not_recorded" });
    }
    let result: Record<string, unknown> = { status: "succeeded" };
    if (action !== "retry_notifications") {
      const code = action === "request_code" ? await codeFor(orderId, operationId) : String(body.code || "");
      if (action === "confirm" && !/^\d{6}$/.test(code)) return jsonResponse({ error: "Enter the six-digit code" }, 400);
      const codeHash = ["request_code", "confirm"].includes(action) ? await hmac(`cash-proof:${orderId}:${code}`) : null;
      const { data, error } = await admin.rpc("cash_desk_action", { p_actor: user.id, p_operation_id: operationId, p_order_id: orderId, p_action: action, p_code_hash: codeHash });
      if (error) return jsonResponse({ status: "rejected", error: error.message }, error.code === "42501" ? 403 : 200);
      result = data;
    }
    // Notification errors never undo cash confirmation or ask staff to collect cash again.
    let notifications: { kind: string; status: string }[] = [];
    if (result.status === "succeeded") {
      try { notifications = await deliver(admin, orderId); }
      catch { notifications = [{ kind: "queue", status: "error" }]; }
    }
    return jsonResponse({ ...result, notifications });
  } catch {
    // Do not log request bodies, OTPs, hashes, email provider bodies or credentials.
    return jsonResponse({ error: "Cash action status unknown. Retry the same operation." }, 500);
  }
});
