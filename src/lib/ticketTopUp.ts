export const COINS_URL = "https://pinkd.hashtag.dance/coins";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function ticketReference(orderId: string | null | undefined): string | null {
  return orderId && uuid.test(orderId) ? orderId.slice(0, 8).toUpperCase() : null;
}

export function ticketTopUpUrl(orderId: string, walletId: string): string {
  const ref = ticketReference(orderId);
  if (!ref || !uuid.test(walletId)) throw new Error("This band does not have a valid ticket link.");
  const url = new URL(COINS_URL);
  url.searchParams.set("ref", ref);
  url.searchParams.set("band", walletId);
  return url.toString();
}

// A URL is only a selection hint. The returned active bands and checkout RPC remain authoritative.
export function selectLinkedBand(bands: { wallet_id: string }[], requested: string | null, matched: string | null): string | null {
  if (requested) return bands.find(band => band.wallet_id === requested)?.wallet_id || null;
  return bands.find(band => band.wallet_id === matched)?.wallet_id || (bands.length === 1 ? bands[0].wallet_id : null);
}

export function isLinkedTicket(data: unknown, orderId: string, walletId: string): boolean {
  if (!data || typeof data !== "object") return false;
  const value = data as { order_id?: unknown; bands?: { wallet_id?: unknown }[] };
  return value.order_id === orderId && Array.isArray(value.bands) && value.bands.some(band => band.wallet_id === walletId);
}
