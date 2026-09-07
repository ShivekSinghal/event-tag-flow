// Cash at the studio counter — the manager's side.
//
// The student booked on the public checkout with "Pay cash at the studio" (5-minute hold).
// POST { action: "request_code", order_id } → emails the student a 6-digit code (max 3 resends).
// POST { action: "confirm", order_id, code }  → marks the order paid, sends the normal
//                                               confirmation email, alerts the admins.
// POST { action: "cancel", order_id }         → releases the hold.
// Caller must be a signed-in studio_manager or admin.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.56.0";
import { Resend } from "npm:resend@4.0.0";
import { corsHeaders, getSupabaseAdmin, jsonResponse } from "../_shared/cashfree.ts";
import { sendEventConfirmationEmail } from "../_shared/eventEmail.ts";

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 3;
const MAX_RESENDS = 3;
const BRAND = "Pink'd";

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newCode() {
  return (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).toString().padStart(6, "0");
}
function inr(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function fromAddress() {
  return Deno.env.get("EVENT_CONFIRMATION_EMAIL_FROM") || Deno.env.get("RESEND_FROM_EMAIL") || `${BRAND} <onboarding@resend.dev>`;
}
function itemsLabelOf(items: { package_name: string; quantity: number }[] | null) {
  return (items || []).map((i) => `${i.package_name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ") || `${BRAND} booking`;
}

async function sendCodeEmail(to: string, name: string, code: string, amount: number, items: string, studio: string, manager: string, ref: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  const first = name.trim().split(" ")[0] || "there";
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111;">
    <p style="margin:0 0 12px;font-size:14px;color:#555;">${BRAND} · cash payment · ref ${ref}</p>
    <h1 style="margin:0 0 12px;font-size:22px;">Hi ${escapeHtml(first)}, confirm your cash payment</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      ${escapeHtml(manager)} at <b>${escapeHtml(studio)}</b> is confirming <b>${inr(amount)}</b> in cash from you for
      <b>${escapeHtml(items)}</b>. If that's right, read this code out at the counter:
    </p>
    <div style="font-size:36px;letter-spacing:8px;font-weight:800;text-align:center;padding:16px;border:2px dashed #FF007F;border-radius:12px;margin:0 0 16px;">${code}</div>
    <p style="margin:0 0 8px;font-size:13px;color:#555;line-height:1.6;">
      The code works for ${CODE_TTL_MINUTES} minutes. Your booking is confirmed only after it's entered — you'll then get your confirmation email with the same reference.
    </p>
    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">If the amount or the pass is wrong, don't share the code — tell the person at the counter.</p>
  </div>`;
  const result = await new Resend(key).emails.send({ from: fromAddress(), to: [to], subject: `${code} is your ${BRAND} cash payment code`, html });
  if (result.error) throw new Error(result.error.message || "Email send failed");
}

async function alertAdmins(order: { id: string; customer_name: string; customer_studio: string | null; total_amount_inr: number }, items: string, manager: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = (Deno.env.get("CASH_BOOKING_ALERT_TO") || "manas210890@gmail.com,ayushi.pathania@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || to.length === 0) return;
  const ref = order.id.slice(0, 8).toUpperCase();
  await new Resend(key).emails.send({
    from: fromAddress(),
    to,
    subject: `Cash booking ${ref} · ${inr(Number(order.total_amount_inr))} · ${order.customer_studio || "studio"}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#111;">
      <b>${escapeHtml(order.customer_name)}</b> paid <b>${inr(Number(order.total_amount_inr))}</b> in cash for ${escapeHtml(items)}.<br>
      Ref ${ref} · received by ${escapeHtml(manager)} at ${escapeHtml(order.customer_studio || "studio")} · confirmed by the student's emailed code.<br>
      <span style="color:#555">Reconcile against that studio's cash box.</span></div>`,
  }).catch((e) => console.warn("cash-booking: admin alert failed", e));
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return jsonResponse({ error: "Sign in as a studio manager" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Sign in as a studio manager" }, 401);
    const uid = userData.user.id;

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin.from("profiles").select("role, full_name, email").eq("id", uid).single();
    if (!["admin", "studio_manager"].includes(profile?.role || "")) {
      return jsonResponse({ error: "Only studio managers and admins can confirm cash" }, 403);
    }
    const managerLabel = String(profile?.full_name || profile?.email || "staff");

    const body = await req.json();
    const action = String(body.action || "");
    const orderId = String(body.order_id || "");
    if (!orderId) return jsonResponse({ error: "order_id is required" }, 400);

    const { data: order } = await admin
      .from("event_orders")
      .select("id, customer_name, customer_email, customer_studio, total_amount_inr, payment_status, payment_provider, checkout_token_expires_at, created_at")
      .eq("id", orderId)
      .single();
    if (!order || order.payment_provider !== "cash") return jsonResponse({ error: "Cash order not found" }, 404);
    if (["paid", "completed"].includes(order.payment_status)) return jsonResponse({ error: "Already paid", confirmed: true }, 409);
    if (order.payment_status === "cancelled") return jsonResponse({ error: "This booking was cancelled — the student needs to book again" }, 409);
    const ref = orderId.slice(0, 8).toUpperCase();

    const { data: items } = await admin.from("event_order_items").select("package_name, quantity").eq("order_id", orderId);
    const itemsLabel = itemsLabelOf(items as { package_name: string; quantity: number }[] | null);
    const { data: conf } = await admin.from("cash_booking_confirmations").select("*").eq("order_id", orderId).maybeSingle();

    if (action === "request_code") {
      const holdLive = new Date(order.checkout_token_expires_at || order.created_at).getTime() > Date.now();
      if (!holdLive) return jsonResponse({ error: "The 5-minute hold has expired — tap Revive first" }, 410);
      if (conf && conf.resends >= MAX_RESENDS) return jsonResponse({ error: "Too many codes sent — cancel and let the student book again" }, 429);

      const code = newCode();
      const row = {
        order_id: orderId,
        code_hash: await sha256Hex(`${orderId}:${code}`),
        sent_to: String(order.customer_email).trim().toLowerCase(),
        expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
        attempts: 0,
        resends: conf ? conf.resends + 1 : 0,
        requested_by: uid,
        requested_by_label: managerLabel,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = conf
        ? await admin.from("cash_booking_confirmations").update(row).eq("id", conf.id)
        : await admin.from("cash_booking_confirmations").insert(row);
      if (upErr) throw upErr;
      // Keep the hold alive while the student finds the email.
      await admin.from("event_orders").update({ checkout_token_expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString() }).eq("id", orderId);

      await sendCodeEmail(order.customer_email, order.customer_name, code, Number(order.total_amount_inr), itemsLabel, order.customer_studio || "the studio", managerLabel, ref);
      return jsonResponse({ sent: true, sent_to: order.customer_email, expires_in_minutes: CODE_TTL_MINUTES, resends_left: MAX_RESENDS - row.resends });
    }

    if (action === "confirm") {
      if (!conf) return jsonResponse({ error: "Send the code first" }, 400);
      const code = String(body.code || "").replace(/\D/g, "");
      if (code.length !== 6) return jsonResponse({ error: "Enter the 6-digit code from the student's email" }, 400);
      if (new Date(conf.expires_at).getTime() < Date.now()) return jsonResponse({ error: "Code expired — send a new one" }, 410);
      if (conf.attempts >= MAX_ATTEMPTS) return jsonResponse({ error: "Too many wrong codes — send a new one" }, 429);
      if ((await sha256Hex(`${orderId}:${code}`)) !== conf.code_hash) {
        await admin.from("cash_booking_confirmations").update({ attempts: conf.attempts + 1, updated_at: new Date().toISOString() }).eq("id", conf.id);
        return jsonResponse({ error: `Wrong code (${MAX_ATTEMPTS - conf.attempts - 1} tries left)` }, 400);
      }

      const now = new Date().toISOString();
      const { data: updated, error: updErr } = await admin
        .from("event_orders")
        .update({ payment_status: "paid", paid_at: now, last_payment_verified_at: now, payment_reference: `CASH · ${managerLabel} · ${order.customer_studio || "studio"}` })
        .eq("id", orderId)
        .neq("payment_status", "paid")
        .neq("payment_status", "completed")
        .select("id")
        .maybeSingle();
      if (updErr) throw updErr;
      await admin.from("cash_booking_confirmations").update({ confirmed_at: now, updated_at: now }).eq("id", conf.id);

      const emailResult = updated?.id ? await sendEventConfirmationEmail(admin, orderId) : { sent: false };
      if (updated?.id) await alertAdmins(order, itemsLabel, managerLabel);
      return jsonResponse({ confirmed: true, order_ref: ref, confirmation_email_sent: Boolean((emailResult as { sent?: boolean }).sent) });
    }

    if (action === "cancel") {
      await admin.from("event_orders").update({ payment_status: "cancelled", checkout_token_expires_at: new Date().toISOString() }).eq("id", orderId).neq("payment_status", "paid");
      return jsonResponse({ cancelled: true });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("cash-booking failed:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Cash confirmation failed" }, 500);
  }
});
