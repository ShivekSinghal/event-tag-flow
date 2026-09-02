import { Resend } from "https://esm.sh/resend@4.0.0";

type SupabaseAdminClient = {
  from: (table: string) => any;
};

type EventOrderItem = {
  package_name: string;
  package_category: string;
  unit_price_inr: number;
  quantity: number;
  line_total_inr: number;
  selected_time_slots: unknown;
};

type EventOrder = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_studio: string | null;
  total_amount_inr: number;
  payment_provider: string;
  payment_reference: string | null;
  paid_at: string | null;
  confirmation_email_sent_at: string | null;
  event_order_items: EventOrderItem[] | null;
};

function formatInr(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-IN")}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getTimeSlots(value: unknown) {
  return Array.isArray(value) ? value.filter((slot): slot is string => typeof slot === "string") : [];
}

function renderItems(items: EventOrderItem[]) {
  return items
    .map((item) => {
      const slots = getTimeSlots(item.selected_time_slots);
      const slotHtml = slots.length
        ? `<div style="margin-top:6px;color:#777;font-size:13px;">Slots: ${slots.map(escapeHtml).join("; ")}</div>`
        : "";

      return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #eee;">
            <div style="font-weight:700;color:#111;">${escapeHtml(item.package_name)}</div>
            <div style="margin-top:4px;color:#777;font-size:13px;">${escapeHtml(item.package_category)} · ${formatInr(Number(item.unit_price_inr))} x ${item.quantity}</div>
            ${slotHtml}
          </td>
          <td style="padding:14px 0;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:#111;">
            ${formatInr(Number(item.line_total_inr))}
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderConfirmationEmail(order: EventOrder) {
  const orderRef = order.id.slice(0, 8).toUpperCase();
  const items = order.event_order_items || [];
  const paidAt = order.paid_at ? new Date(order.paid_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "";

  return `
    <div style="margin:0;padding:0;background:#08050b;font-family:Arial,sans-serif;color:#111;">
      <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
        <div style="background:#ffffff;border-radius:16px;overflow:hidden;">
          <div style="background:#fb0088;padding:24px;">
            <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:.04em;">Pink'D</div>
            <div style="margin-top:8px;color:#fff;font-size:15px;">Event booking confirmed</div>
          </div>
          <div style="padding:26px;">
            <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:#111;">You are booked, ${escapeHtml(order.customer_name)}.</h1>
            <p style="margin:0 0 20px;color:#555;line-height:1.6;">Your payment has been confirmed and your Pink'D event order is now reserved.</p>

            <div style="background:#f8f8f8;border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:20px;">
              <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;">
                <span style="color:#777;">Order Ref</span>
                <strong style="color:#111;">${orderRef}</strong>
              </div>
              <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;">
                <span style="color:#777;">Payment</span>
                <strong style="color:#111;">${escapeHtml(order.payment_provider || "payment")}</strong>
              </div>
              ${order.customer_studio ? `<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;"><span style="color:#777;">Studio</span><strong style="color:#111;">${escapeHtml(order.customer_studio)}</strong></div>` : ""}
              ${paidAt ? `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="color:#777;">Paid At</span><strong style="color:#111;">${escapeHtml(paidAt)}</strong></div>` : ""}
            </div>

            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
              <tbody>
                ${renderItems(items)}
              </tbody>
            </table>

            <div style="display:flex;justify-content:space-between;gap:12px;font-size:20px;font-weight:900;color:#111;">
              <span>Total Paid</span>
              <span>${formatInr(Number(order.total_amount_inr))}</span>
            </div>

            <p style="margin:24px 0 0;color:#666;line-height:1.6;font-size:14px;">
              Please keep this email handy for entry. This event booking is separate from Pink'D Coins and does not credit your NFC wallet.
            </p>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function sendEventConfirmationEmail(supabase: SupabaseAdminClient, eventOrderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("event_orders")
    .select("id, customer_name, customer_email, customer_phone, customer_studio, total_amount_inr, payment_provider, payment_reference, paid_at, confirmation_email_sent_at, event_order_items(*)")
    .eq("id", eventOrderId)
    .single();

  if (orderError || !order) {
    throw orderError || new Error("Event order not found for confirmation email");
  }

  if (order.confirmation_email_sent_at) {
    return { sent: true, skipped: true, emailId: null };
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    const message = "RESEND_API_KEY is not configured";
    await supabase.from("event_orders").update({ confirmation_email_error: message }).eq("id", eventOrderId);
    return { sent: false, skipped: false, error: message };
  }

  const resend = new Resend(resendApiKey);
  const from = Deno.env.get("EVENT_CONFIRMATION_EMAIL_FROM") || Deno.env.get("RESEND_FROM_EMAIL") || "Pink'D <onboarding@resend.dev>";
  const orderRef = order.id.slice(0, 8).toUpperCase();
  const emailResult = await resend.emails.send({
    from,
    to: [order.customer_email],
    subject: `Pink'D booking confirmed - ${orderRef}`,
    html: renderConfirmationEmail(order as EventOrder),
  });

  if (emailResult.error) {
    const message = emailResult.error.message || "Confirmation email failed";
    await supabase.from("event_orders").update({ confirmation_email_error: message }).eq("id", eventOrderId);
    return { sent: false, skipped: false, error: message };
  }

  const emailId = emailResult.data?.id || null;
  await supabase
    .from("event_orders")
    .update({
      confirmation_email_sent_at: new Date().toISOString(),
      confirmation_email_id: emailId,
      confirmation_email_error: null,
    })
    .eq("id", eventOrderId);

  return { sent: true, skipped: false, emailId };
}
