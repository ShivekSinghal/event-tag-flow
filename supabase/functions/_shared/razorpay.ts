export const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";

export function getRazorpayConfig(publicKeyId?: string | null) {
  const keyId = publicKeyId || Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured");
  }

  return {
    keyId,
    keySecret,
  };
}

function getRazorpaySecret() {
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

  if (!keySecret) {
    throw new Error("Razorpay key secret is not configured");
  }

  return keySecret;
}

export function makeRazorpayAuthHeader(keyId: string, keySecret: string) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

export function makeRazorpayReceipt(eventOrderId: string) {
  return `pinkd_${eventOrderId.replace(/-/g, "").slice(0, 26)}`;
}

export async function createRazorpayOrder(params: {
  eventOrderId: string;
  amountInr: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  keyId?: string | null;
}) {
  const config = getRazorpayConfig(params.keyId);
  const amountPaise = Math.round(params.amountInr * 100);

  const response = await fetch(`${RAZORPAY_BASE_URL}/orders`, {
    method: "POST",
    headers: {
      "Authorization": makeRazorpayAuthHeader(config.keyId, config.keySecret),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      receipt: makeRazorpayReceipt(params.eventOrderId),
      notes: {
        event_order_id: params.eventOrderId,
        customer_name: params.customerName,
        customer_email: params.customerEmail,
        customer_phone: params.customerPhone,
      },
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.description || payload?.message || "Razorpay order creation failed";
    throw new Error(message);
  }

  return { payload, keyId: config.keyId, amountPaise };
}

export async function fetchRazorpayPayment(paymentId: string, keyId?: string | null) {
  const config = getRazorpayConfig(keyId);
  const response = await fetch(`${RAZORPAY_BASE_URL}/payments/${encodeURIComponent(paymentId)}`, {
    method: "GET",
    headers: {
      "Authorization": makeRazorpayAuthHeader(config.keyId, config.keySecret),
      "Content-Type": "application/json",
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.description || payload?.message || "Razorpay payment verification failed";
    throw new Error(message);
  }

  return payload;
}

export async function verifyRazorpayPaymentSignature(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const keySecret = getRazorpaySecret();
  const computedSignature = await hmacSha256Hex(`${params.razorpayOrderId}|${params.razorpayPaymentId}`, keySecret);
  return timingSafeEqual(computedSignature, params.razorpaySignature);
}

export async function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || Deno.env.get("RAZORPAY_KEY_SECRET") || "";
  if (!webhookSecret) {
    throw new Error("Razorpay webhook secret is not configured");
  }

  const computedSignature = await hmacSha256Hex(rawBody, webhookSecret);
  return timingSafeEqual(computedSignature, signature);
}

async function hmacSha256Hex(message: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
