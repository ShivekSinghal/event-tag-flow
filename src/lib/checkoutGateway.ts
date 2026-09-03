import { supabase } from "@/integrations/supabase/client";

/**
 * Shared payment-gateway plumbing for every Pink'd checkout surface
 * (the booking page cart and the ticket-holder coins page).
 *
 * The browser never decides a price: it creates an order through a
 * server-side RPC, asks `event-payment-create` for a gateway session,
 * opens the gateway, then asks `event-payment-verify` to confirm.
 */

export type CashfreeMode = "sandbox" | "production";
export type PaymentProvider = "cashfree" | "razorpay";

type CashfreeCheckout = {
  checkout: (options: { paymentSessionId: string; redirectTarget: "_modal" | "_self" | "_blank" | "_top" }) => Promise<unknown>;
};

export type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
  theme: {
    color: string;
  };
  handler: (response: RazorpayCheckoutResponse) => void;
  modal: {
    ondismiss: () => void;
  };
};

type RazorpayCheckout = {
  open: () => void;
};

declare global {
  interface Window {
    Cashfree?: (options: { mode: CashfreeMode }) => CashfreeCheckout;
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckout;
  }
}

export const BRAND_NAME = "Pink'd";
export const BRAND_COLOR = "#ff007f";

const cashfreeScriptId = "cashfree-checkout-js";
const razorpayScriptId = "razorpay-checkout-js";

export function loadCashfreeSdk() {
  if (window.Cashfree) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(cashfreeScriptId) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Cashfree checkout could not load")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = cashfreeScriptId;
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Cashfree checkout could not load"));
    document.head.appendChild(script);
  });
}

export function loadRazorpaySdk() {
  if (window.Razorpay) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(razorpayScriptId) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Razorpay checkout could not load")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = razorpayScriptId;
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay checkout could not load"));
    document.head.appendChild(script);
  });
}

export function openRazorpayCheckout(paymentData: {
  key_id: string;
  amount_paise: number;
  currency: string;
  razorpay_order_id: string;
  description?: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
}, onCheckoutSurfaceVisible?: () => void) {
  return new Promise<RazorpayCheckoutResponse | null>((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error("Razorpay checkout is unavailable"));
      return;
    }

    const checkout = new window.Razorpay({
      key: paymentData.key_id,
      amount: paymentData.amount_paise,
      currency: paymentData.currency,
      name: BRAND_NAME,
      description: paymentData.description || "Pink'd event booking",
      order_id: paymentData.razorpay_order_id,
      prefill: {
        name: paymentData.customer.name,
        email: paymentData.customer.email,
        contact: paymentData.customer.phone,
      },
      theme: {
        color: BRAND_COLOR,
      },
      handler: (response) => resolve(response),
      modal: {
        ondismiss: () => resolve(null),
      },
    });

    checkout.open();
    waitForCheckoutSurface("razorpay").then((isVisible) => {
      if (isVisible) onCheckoutSurfaceVisible?.();
    });
  });
}

function checkoutSurfaceSelector(provider: PaymentProvider) {
  if (provider === "razorpay") {
    return [
      ".razorpay-container",
      ".razorpay-backdrop",
      ".razorpay-checkout-frame",
      "[class*='razorpay']",
      "[id*='razorpay']",
      "iframe[src*='razorpay.com']",
      "iframe[src*='checkout.razorpay.com']",
    ].join(",");
  }

  return [
    "[class*='cashfree']",
    "[id*='cashfree']",
    "iframe[src*='cashfree.com']",
    "iframe[src*='payments.cashfree.com']",
  ].join(",");
}

function isVisibleCheckoutElement(element: Element) {
  const styles = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return styles.display !== "none" && styles.visibility !== "hidden" && rect.width > 40 && rect.height > 40;
}

export function waitForCheckoutSurface(provider: PaymentProvider, timeoutMs = 12000) {
  return new Promise<boolean>((resolve) => {
    const selector = checkoutSurfaceSelector(provider);

    const findSurface = () => Array.from(document.querySelectorAll(selector)).some(isVisibleCheckoutElement);

    if (findSurface()) {
      resolve(true);
      return;
    }

    const observer = new MutationObserver(() => {
      if (findSurface()) {
        cleanup();
        resolve(true);
      }
    });

    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const cleanup = () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };

    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class", "id", "src", "style"],
    });
  });
}

export function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function waitForSheetCloseAnimation() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 360));
}

export function getGatewayLabel(provider: PaymentProvider) {
  return provider === "razorpay" ? "Razorpay" : "Cashfree";
}

export function getPaymentErrorMessage(error: unknown, provider?: PaymentProvider) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    if (/authentication failed/i.test(error.message)) {
      if (provider === "cashfree") {
        return "Cashfree authentication failed. Check that Supabase CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET are the correct Payment Gateway keys for the selected Cashfree mode.";
      }

      if (provider === "razorpay") {
        return "Razorpay authentication failed. Update the Supabase RAZORPAY_KEY_SECRET so it matches the active Razorpay key id in the admin payment settings.";
      }

      return "Payment gateway authentication failed. Check that the selected gateway's Supabase secrets match the active payment settings.";
    }

    return error.message;
  }

  return "Payment could not be completed. The booking is pending for manual follow-up.";
}

export async function getFunctionErrorMessage(error: unknown, data: unknown) {
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return data.error;
  }

  const context = error && typeof error === "object" && "context" in error ? error.context : null;
  if (context instanceof Response) {
    try {
      const payload = await context.clone().json();
      if (payload?.error) return String(payload.error);
    } catch {
      // Fall back to the Supabase client error message below.
    }
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Payment setup failed";
}

export function createCheckoutToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type GatewayPaymentResult = {
  provider: PaymentProvider;
  paymentStatus: string;
  isPaid: boolean;
  confirmationEmailSent: boolean;
  confirmationEmailError: string | null;
};

/**
 * Runs the full gateway round-trip for an order that already exists in
 * `event_orders`: create the gateway session, open the gateway modal, then
 * verify the outcome server-side. Resolves with the verified status, or
 * rejects when the gateway could not be opened / the buyer dismissed it.
 */
export async function runGatewayPayment(params: {
  orderId: string;
  checkoutToken: string;
  fallbackCustomer: { name: string; email: string; phone: string };
  description?: string;
  onProviderKnown?: (provider: PaymentProvider) => void;
  onGatewayVisible?: () => void;
}): Promise<GatewayPaymentResult> {
  const { data: paymentData, error: paymentError } = await supabase.functions.invoke("event-payment-create", {
    body: { event_order_id: params.orderId, checkout_token: params.checkoutToken },
  });

  const provider: PaymentProvider = paymentData?.provider === "razorpay" ? "razorpay" : "cashfree";
  if (paymentData?.provider === "cashfree" || paymentData?.provider === "razorpay") {
    params.onProviderKnown?.(provider);
  }

  if (paymentError) throw new Error(await getFunctionErrorMessage(paymentError, paymentData));

  if (provider === "razorpay") {
    const razorpayOrderId = paymentData?.razorpay_order_id as string | undefined;
    const keyId = paymentData?.key_id as string | undefined;
    const amountPaise = paymentData?.amount_paise as number | undefined;

    if (!razorpayOrderId || !keyId || !amountPaise) {
      throw new Error("Razorpay did not return a checkout order");
    }

    await waitForNextFrame();
    await loadRazorpaySdk();
    const checkoutResponse = await openRazorpayCheckout({
      key_id: keyId,
      amount_paise: amountPaise,
      currency: paymentData?.currency || "INR",
      razorpay_order_id: razorpayOrderId,
      description: params.description,
      customer: paymentData?.customer || params.fallbackCustomer,
    }, params.onGatewayVisible);

    if (!checkoutResponse) {
      throw new Error("Razorpay checkout was closed before payment completed");
    }

    const { data: verificationData, error: verificationError } = await supabase.functions.invoke("event-payment-verify", {
      body: {
        provider: "razorpay",
        event_order_id: params.orderId,
        checkout_token: params.checkoutToken,
        razorpay_order_id: checkoutResponse.razorpay_order_id,
        razorpay_payment_id: checkoutResponse.razorpay_payment_id,
        razorpay_signature: checkoutResponse.razorpay_signature,
      },
    });

    if (verificationError) throw new Error(await getFunctionErrorMessage(verificationError, verificationData));

    return {
      provider,
      paymentStatus: String(verificationData?.payment_status || "pending"),
      isPaid: verificationData?.payment_status === "paid",
      confirmationEmailSent: Boolean(verificationData?.confirmation_email_sent),
      confirmationEmailError: verificationData?.confirmation_email_error
        ? String(verificationData.confirmation_email_error)
        : null,
    };
  }

  const paymentSessionId = paymentData?.payment_session_id as string | undefined;
  const cashfreeOrderId = paymentData?.cashfree_order_id as string | undefined;
  const mode = (paymentData?.mode === "production" ? "production" : "sandbox") as CashfreeMode;

  if (!paymentSessionId || !cashfreeOrderId) {
    throw new Error("Cashfree did not return a payment session");
  }

  await waitForNextFrame();
  await loadCashfreeSdk();
  const cashfree = window.Cashfree?.({ mode });

  if (!cashfree) {
    throw new Error("Cashfree checkout is unavailable");
  }

  waitForCheckoutSurface("cashfree").then((isVisible) => {
    if (isVisible) params.onGatewayVisible?.();
  });
  await cashfree.checkout({
    paymentSessionId,
    redirectTarget: "_modal",
  });

  const { data: verificationData, error: verificationError } = await supabase.functions.invoke("event-payment-verify", {
    body: {
      provider: "cashfree",
      event_order_id: params.orderId,
      checkout_token: params.checkoutToken,
      cashfree_order_id: cashfreeOrderId,
    },
  });

  if (verificationError) throw new Error(await getFunctionErrorMessage(verificationError, verificationData));

  return {
    provider,
    paymentStatus: String(verificationData?.payment_status || "pending"),
    isPaid: verificationData?.payment_status === "paid",
    confirmationEmailSent: Boolean(verificationData?.confirmation_email_sent),
    confirmationEmailError: verificationData?.confirmation_email_error
      ? String(verificationData.confirmation_email_error)
      : null,
  };
}
