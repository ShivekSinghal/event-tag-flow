export type TrackingCartItem = {
  item_id: string;
  item_name: string;
  item_category: string;
  price: number;
  quantity: number;
};

type TrackingPayload = Record<string, unknown>;

const attributionStorageKey = "pinkd_landing_attribution";
const purchasePrefix = "pinkd_purchase_tracked:";
const leadPrefix = "pinkd_lead_tracked:";

const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

declare global {
  interface Window {
    dataLayer?: TrackingPayload[];
    fbq?: (...args: unknown[]) => void;
  }
}

function isBrowser() {
  return typeof window !== "undefined";
}

function getLocationAttribution() {
  if (!isBrowser()) return {};

  const params = new URLSearchParams(window.location.search);
  const attribution: TrackingPayload = {
    landing_page_url: window.location.href,
    referrer: document.referrer || null,
  };

  utmKeys.forEach((key) => {
    const value = params.get(key);
    if (value) attribution[key] = value;
  });

  return attribution;
}

export function captureLandingAttribution() {
  if (!isBrowser()) return {};

  const current = getLocationAttribution();
  const hasCampaignParam = utmKeys.some((key) => Boolean(current[key]));

  if (hasCampaignParam) {
    sessionStorage.setItem(attributionStorageKey, JSON.stringify(current));
    return current;
  }

  try {
    const stored = sessionStorage.getItem(attributionStorageKey);
    if (stored) return JSON.parse(stored) as TrackingPayload;
  } catch {
    sessionStorage.removeItem(attributionStorageKey);
  }

  sessionStorage.setItem(attributionStorageKey, JSON.stringify(current));
  return current;
}

export function getLandingAttribution() {
  if (!isBrowser()) return {};

  try {
    const stored = sessionStorage.getItem(attributionStorageKey);
    return stored ? (JSON.parse(stored) as TrackingPayload) : captureLandingAttribution();
  } catch {
    sessionStorage.removeItem(attributionStorageKey);
    return captureLandingAttribution();
  }
}

function pushDataLayer(event: string, payload: TrackingPayload) {
  if (!isBrowser()) return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...payload });
}

function trackMeta(event: string, payload: TrackingPayload) {
  if (!isBrowser() || typeof window.fbq !== "function") return;
  window.fbq("track", event, payload);
}

function makeCommercePayload(payload: {
  orderId?: string;
  value: number;
  currency?: string;
  items: TrackingCartItem[];
  source?: string;
  paymentProvider?: string;
}) {
  const quantity = payload.items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    currency: payload.currency || "INR",
    value: payload.value,
    order_id: payload.orderId,
    source: payload.source || "pinkd_landing",
    pricing_phase: "standard",
    product_type: "event_booking",
    payment_provider: payload.paymentProvider,
    content_type: "product",
    content_ids: payload.items.map((item) => item.item_id),
    content_name: payload.items.map((item) => item.item_name).join(", "),
    contents: payload.items.map((item) => ({
      id: item.item_id,
      quantity: item.quantity,
      item_price: item.price,
    })),
    num_items: quantity,
    items: payload.items,
    ...getLandingAttribution(),
  };
}

function trackOnce(key: string, event: string, payload: TrackingPayload, metaEvent = event) {
  if (!isBrowser()) return false;
  if (localStorage.getItem(key)) return false;

  pushDataLayer(event, payload);
  trackMeta(metaEvent, payload);
  localStorage.setItem(key, "1");
  return true;
}

export function trackViewContent(payload: { value: number; items: TrackingCartItem[] }) {
  const eventPayload = makeCommercePayload(payload);
  pushDataLayer("ViewContent", eventPayload);
  trackMeta("ViewContent", eventPayload);
}

export function trackInitiateCheckout(payload: {
  orderId: string;
  value: number;
  items: TrackingCartItem[];
  paymentProvider: string;
}) {
  const eventPayload = makeCommercePayload(payload);
  pushDataLayer("InitiateCheckout", eventPayload);
  trackMeta("InitiateCheckout", eventPayload);
}

export function trackPurchaseOnce(payload: {
  orderId: string;
  value: number;
  items: TrackingCartItem[];
  paymentProvider: string;
}) {
  const eventPayload = makeCommercePayload(payload);
  return trackOnce(`${purchasePrefix}${payload.orderId}`, "Purchase", eventPayload, "Purchase");
}

export function trackLeadOnce(payload: {
  orderId: string;
  value: number;
  items: TrackingCartItem[];
  paymentProvider: string;
}) {
  const eventPayload = makeCommercePayload(payload);
  return trackOnce(`${leadPrefix}${payload.orderId}`, "Lead", eventPayload, "Lead");
}
