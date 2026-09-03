import { Resend } from "https://esm.sh/resend@4.0.0";

type SupabaseAdminClient = {
  from: (table: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => any;
};

type EventOrderItem = {
  package_name: string;
  package_category: string;
  package_key?: string | null;
  unit_price_inr: number;
  quantity: number;
  pax?: number | null;
  line_total_inr: number;
  selected_time_slots: unknown;
  phase_name?: string | null;
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
  booking_source?: string | null;
  parent_order_id?: string | null;
  confirmation_email_sent_at: string | null;
  event_order_items: EventOrderItem[] | null;
};

const BRAND = "Pink'd";
const PINK = "#ff007f";
const INTENSIVE_VENUE_LABEL = "#hashtag Rajouri Garden";
const INTENSIVE_VENUE_ADDRESS = "Hashtag For Dance, Rajouri Garden, New Delhi";
const INTENSIVE_DIRECTIONS_URL = "https://share.google/YFUUQ85X3WYy0wVLE";
const PARTY_DATE_LABEL = "Friday 11 September 2026 · 9 PM till late";
const PARTY_VENUE_LABEL = "Glass Villa";
const PARTY_VENUE_ADDRESS = "Glass Villa, Sector 58, Baliawas, Gurugram";
const PARTY_DIRECTIONS_URL = "https://www.google.com/maps/search/?api=1&query=Glass%20Villa%20Gurgaon";
const WHATSAPP_LINE = "+91 92054 88417";
const WHATSAPP_URL = "https://wa.me/919205488417";
const FREE_GAMES = ["Beer Pong", "Jamaal Challenge", "Red Flag Green Flag", "Squid Games"];

function getSiteUrl() {
  const configured = Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_SITE_URL") || "https://pinkd.hashtag.dance";
  return configured.replace(/\/$/, "");
}

function formatInr(value: number) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getTimeSlots(value: unknown) {
  return Array.isArray(value) ? value.filter((slot): slot is string => typeof slot === "string") : [];
}

function orderRef(order: EventOrder) {
  return order.id.slice(0, 8).toUpperCase();
}

function itemIncludesIntensives(item: EventOrderItem) {
  const category = item.package_category.toLowerCase();
  return getTimeSlots(item.selected_time_slots).length > 0
    || category === "intensives"
    || category === "package"
    || category === "group";
}

function itemIncludesParty(item: EventOrderItem) {
  const category = item.package_category.toLowerCase();
  return category === "party" || category === "package" || category === "group";
}

function partyEntries(items: EventOrderItem[]) {
  return items
    .filter(itemIncludesParty)
    .reduce((sum, item) => sum + Number(item.quantity || 0) * Math.max(Number(item.pax || 1), 1), 0);
}

function coinAmount(item: EventOrderItem) {
  const match = /^(\d[\d,]*)\s/.exec(item.package_name || "");
  return match ? Number(match[1].replace(/,/g, "")) * Number(item.quantity || 0) : 0;
}

function row(label: string, value: string) {
  return `<tr>
    <td style="padding:6px 0;color:#777;font-size:14px;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;color:#111;font-size:14px;font-weight:700;text-align:right;vertical-align:top;">${value}</td>
  </tr>`;
}

function renderItems(items: EventOrderItem[]) {
  return items
    .map((item) => {
      const slots = getTimeSlots(item.selected_time_slots);
      const slotHtml = slots.length
        ? `<div style="margin-top:6px;color:#555;font-size:13px;line-height:1.5;">${slots.map(escapeHtml).join("<br>")}</div>`
        : "";
      const phaseHtml = item.phase_name
        ? `<div style="margin-top:4px;color:#777;font-size:12px;">${escapeHtml(item.phase_name)} price, locked at checkout</div>`
        : "";

      return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #eee;">
            <div style="font-weight:700;color:#111;">${escapeHtml(item.package_name)}</div>
            <div style="margin-top:4px;color:#777;font-size:13px;">${formatInr(Number(item.unit_price_inr))} × ${item.quantity}${item.pax ? ` · ${item.pax} people` : ""}</div>
            ${slotHtml}
            ${phaseHtml}
          </td>
          <td style="padding:14px 0;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:#111;white-space:nowrap;">
            ${formatInr(Number(item.line_total_inr))}
          </td>
        </tr>
      `;
    })
    .join("");
}

function shell(title: string, subtitle: string, body: string) {
  return `
    <div style="margin:0;padding:0;background:#08050b;font-family:Arial,Helvetica,sans-serif;color:#111;">
      <div style="max-width:640px;margin:0 auto;padding:28px 16px;">
        <div style="background:#ffffff;border-radius:16px;overflow:hidden;">
          <div style="background:${PINK};padding:24px;">
            <img src="${getSiteUrl()}/media/pinkd-logo.png" alt="${BRAND}" width="120" style="display:block;height:auto;max-width:120px;" />
            <div style="margin-top:12px;color:#fff;font-size:20px;font-weight:900;">${escapeHtml(title)}</div>
            <div style="margin-top:4px;color:#fff;font-size:14px;opacity:.92;">${escapeHtml(subtitle)}</div>
          </div>
          <div style="padding:26px;">
            ${body}
          </div>
          <div style="padding:16px 26px 24px;color:#888;font-size:12px;line-height:1.6;border-top:1px solid #eee;">
            ${BRAND} · A FUN'draiser by Hashtag For Dance · 7 years of ${BRAND}<br>
            Questions? WhatsApp <a href="${WHATSAPP_URL}" style="color:${PINK};font-weight:700;">${WHATSAPP_LINE}</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTicketEmail(order: EventOrder, prepaidCoins: number) {
  const ref = orderRef(order);
  const items = order.event_order_items || [];
  const paidAt = order.paid_at ? new Date(order.paid_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "";
  const includesIntensives = items.some(itemIncludesIntensives);
  const includesParty = items.some(itemIncludesParty);
  const entries = partyEntries(items);
  const needsAttendeeForm = entries > 1;
  const siteUrl = getSiteUrl();
  const sessionSlots = Array.from(new Set(items.flatMap((item) => getTimeSlots(item.selected_time_slots))));

  const sessionsBlock = includesIntensives
    ? `<div style="margin-top:22px;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${PINK};">Your intensives</div>
        <div style="margin-top:8px;color:#111;font-size:15px;line-height:1.7;">${sessionSlots.map(escapeHtml).join("<br>") || "See your passes above"}</div>
        <div style="margin-top:6px;color:#555;font-size:13px;line-height:1.6;">${escapeHtml(INTENSIVE_VENUE_LABEL)} · ${escapeHtml(INTENSIVE_VENUE_ADDRESS)}<br>
        <a href="${INTENSIVE_DIRECTIONS_URL}" style="color:${PINK};font-weight:700;">Directions</a> · Doors 30 minutes before each session. Styles are announced on Instagram before the event.</div>
      </div>`
    : "";

  const partyBlock = includesParty
    ? `<div style="margin-top:22px;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${PINK};">The party</div>
        <div style="margin-top:8px;color:#111;font-size:15px;line-height:1.7;">${escapeHtml(PARTY_DATE_LABEL)}<br>${escapeHtml(PARTY_VENUE_ADDRESS)}</div>
        <div style="margin-top:6px;color:#555;font-size:13px;line-height:1.6;">
          <a href="${PARTY_DIRECTIONS_URL}" style="color:${PINK};font-weight:700;">Directions to ${escapeHtml(PARTY_VENUE_LABEL)}</a><br>
          ${entries} ${entries === 1 ? "entry" : "entries"} · each includes a wristband, a welcome drink and four free games: ${FREE_GAMES.join(", ")}. Every other game and the bar run on ${BRAND} Coins, loaded onto your band at the venue.
        </div>
      </div>`
    : "";

  const attendeeBlock = includesParty && needsAttendeeForm
    ? `<div style="margin-top:22px;padding:16px;border-radius:12px;background:#fff0f7;border:1px solid #ffc2df;">
        <div style="font-weight:800;color:#111;">One name per wristband</div>
        <div style="margin-top:4px;color:#555;font-size:14px;line-height:1.6;">Your booking covers ${entries} people. Add a name and phone for each entry so the bands are ready at the gate.</div>
        <a href="${siteUrl}/attendees?ref=${ref}" style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:999px;background:${PINK};color:#fff;font-weight:800;text-decoration:none;">Add attendee names</a>
      </div>`
    : "";

  const coinsBlock = includesParty
    ? `<div style="margin-top:22px;padding:16px;border-radius:12px;background:#f8f8f8;border:1px solid #eee;">
        <div style="font-weight:800;color:#111;">${BRAND} Coins for the games</div>
        <div style="margin-top:4px;color:#555;font-size:14px;line-height:1.6;">
          ${prepaidCoins > 0 ? `${prepaidCoins.toLocaleString("en-IN")} coins are already booked against this order and will be loaded at the gate. ` : ""}
          Buy coin packs ahead of the night with this private link (it works only with your order reference), or top up at the venue.
        </div>
        <a href="${siteUrl}/coins?ref=${ref}" style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:999px;background:#111;color:#fff;font-weight:800;text-decoration:none;">Buy ${BRAND} Coins</a>
      </div>`
    : "";

  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:#111;">You're booked, ${escapeHtml(order.customer_name)}.</h1>
    <p style="margin:0 0 18px;color:#555;line-height:1.6;">Payment received. Keep this email — your order reference is your ticket.</p>

    <div style="background:#f8f8f8;border:1px solid #eee;border-radius:12px;padding:12px 16px;margin-bottom:18px;">
      <table style="width:100%;border-collapse:collapse;">
        ${row("Order reference", `<span style="font-size:18px;letter-spacing:.08em;">${ref}</span>`)}
        ${row("Booked by", escapeHtml(order.customer_name))}
        ${row("Phone", escapeHtml(order.customer_phone))}
        ${order.customer_studio ? row("Studio", escapeHtml(order.customer_studio)) : ""}
        ${row("Payment", `${escapeHtml(order.payment_provider || "online")}${paidAt ? ` · ${escapeHtml(paidAt)}` : ""}`)}
      </table>
    </div>

    <table style="width:100%;border-collapse:collapse;">
      <tbody>${renderItems(items)}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <tr>
        <td style="font-size:18px;font-weight:900;color:#111;">Total paid</td>
        <td style="font-size:18px;font-weight:900;color:#111;text-align:right;">${formatInr(Number(order.total_amount_inr))}</td>
      </tr>
    </table>

    ${sessionsBlock}
    ${partyBlock}
    ${attendeeBlock}
    ${coinsBlock}

    <div style="margin-top:24px;padding:14px 16px;border-radius:12px;background:#111;color:#fff;font-size:13px;line-height:1.7;">
      <b>The party is 18+.</b> Valid photo ID is checked at the gate; under-18s with a full pass forfeit the party portion, no refund.<br>
      <b>No refunds, no transfers</b> on any ticket, including crew passes.<br>
      Intensives are open to all ages.
    </div>
  `;

  return shell("Booking confirmed", `Order ${ref} · 9–11 September 2026`, body);
}

function renderCoinEmail(order: EventOrder, parent: EventOrder | null) {
  const ref = orderRef(order);
  const parentRef = parent ? orderRef(parent) : null;
  const items = order.event_order_items || [];
  const coins = items.reduce((sum, item) => sum + coinAmount(item), 0);

  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:#111;">${coins.toLocaleString("en-IN")} ${BRAND} Coins, booked.</h1>
    <p style="margin:0 0 18px;color:#555;line-height:1.6;">
      They're reserved against ${parentRef ? `party ticket <b>${parentRef}</b>` : "your party ticket"} and will be loaded onto your wristband when you collect it at the gate on ${escapeHtml(PARTY_DATE_LABEL)}.
    </p>

    <div style="background:#f8f8f8;border:1px solid #eee;border-radius:12px;padding:12px 16px;margin-bottom:18px;">
      <table style="width:100%;border-collapse:collapse;">
        ${row("Coin order", ref)}
        ${parentRef ? row("Party ticket", parentRef) : ""}
        ${row("Name", escapeHtml(order.customer_name))}
        ${row("Payment", escapeHtml(order.payment_provider || "online"))}
      </table>
    </div>

    <table style="width:100%;border-collapse:collapse;">
      <tbody>${renderItems(items)}</tbody>
    </table>
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <tr>
        <td style="font-size:18px;font-weight:900;color:#111;">Total paid</td>
        <td style="font-size:18px;font-weight:900;color:#111;text-align:right;">${formatInr(Number(order.total_amount_inr))}</td>
      </tr>
    </table>

    <p style="margin:22px 0 0;color:#555;font-size:14px;line-height:1.6;">
      Show your party ticket reference at the counter and the coins go straight onto the band. Need more on the night? Top up at the venue.
      Coin purchases are non-refundable.
    </p>
  `;

  return shell(`${BRAND} Coins confirmed`, `Order ${ref}`, body);
}

export async function sendEventConfirmationEmail(supabase: SupabaseAdminClient, eventOrderId: string) {
  const { data: order, error: orderError } = await supabase
    .from("event_orders")
    .select("id, customer_name, customer_email, customer_phone, customer_studio, total_amount_inr, payment_provider, payment_reference, paid_at, booking_source, parent_order_id, confirmation_email_sent_at, event_order_items(*)")
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

  const typedOrder = order as EventOrder;
  const isCoinOrder = typedOrder.booking_source === "coins_page" || Boolean(typedOrder.parent_order_id);
  const ref = orderRef(typedOrder);

  let html: string;
  let subject: string;

  if (isCoinOrder) {
    let parent: EventOrder | null = null;
    if (typedOrder.parent_order_id) {
      const { data: parentOrder } = await supabase
        .from("event_orders")
        .select("id, customer_name, customer_email, customer_phone, customer_studio, total_amount_inr, payment_provider, payment_reference, paid_at, confirmation_email_sent_at")
        .eq("id", typedOrder.parent_order_id)
        .maybeSingle();
      parent = (parentOrder as EventOrder | null) || null;
    }
    html = renderCoinEmail(typedOrder, parent);
    subject = `${BRAND} Coins confirmed - ${ref}`;
  } else {
    let prepaidCoins = 0;
    try {
      if (supabase.rpc) {
        const { data } = await supabase.rpc("get_prepaid_coins_for_order", { p_parent_order_id: typedOrder.id });
        prepaidCoins = Number(data || 0);
      }
    } catch {
      prepaidCoins = 0;
    }
    html = renderTicketEmail(typedOrder, prepaidCoins);
    subject = `${BRAND} booking confirmed - ${ref}`;
  }

  const resend = new Resend(resendApiKey);
  const from = Deno.env.get("EVENT_CONFIRMATION_EMAIL_FROM") || Deno.env.get("RESEND_FROM_EMAIL") || `${BRAND} <onboarding@resend.dev>`;
  const emailResult = await resend.emails.send({
    from,
    to: [typedOrder.customer_email],
    subject,
    html,
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
