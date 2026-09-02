export async function sha256Hex(value: string) {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateCheckoutToken(params: {
  providedToken: string | null | undefined;
  expectedHash: string | null | undefined;
  expiresAt: string | null | undefined;
}) {
  if (!params.providedToken || !params.expectedHash || !params.expiresAt) {
    return false;
  }

  if (new Date(params.expiresAt).getTime() < Date.now()) {
    return false;
  }

  const providedHash = await sha256Hex(params.providedToken);
  return timingSafeEqual(providedHash, params.expectedHash.toLowerCase());
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}
