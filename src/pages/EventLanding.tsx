import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronsUpDown,
  Coins,
  CreditCard,
  Loader2,
  Mail,
  MapPin,
  Minus,
  Phone,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Ticket,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  EVENT_CATEGORY_LABELS,
  EVENT_PACKAGE_OPTIONS,
  EVENT_TIME_SLOTS,
  EventPackageOption,
  formatEventPrice,
  getDefaultTimeSlots,
  normalizeEventPackage,
} from "@/lib/eventPackages";
import { formatCoins } from "@/lib/coins";
import {
  captureLandingAttribution,
  getLandingAttribution,
  trackInitiateCheckout,
  trackLeadOnce,
  trackPurchaseOnce,
  trackViewContent,
  type TrackingCartItem,
} from "@/lib/tracking";

type CartItem = {
  id: string;
  packageId: string;
  quantity: number;
  selectedTimeSlots: string[];
};

type CoinPackage = {
  id: string;
  inr_amount: number;
  coin_amount: number;
  active: boolean;
  display_order: number;
};

type CoinCartItem = {
  id: string;
  coinPackageId: string;
  quantity: number;
};

type CheckoutFormState = {
  name: string;
  phone: string;
  email: string;
  studio: string;
};

const initialFormState: CheckoutFormState = {
  name: "",
  phone: "",
  email: "",
  studio: "",
};

const STUDIO_OPTIONS = [
  "Noida Sector 43 (NDA)",
  "Noida Sector 50 (RMG)",
  "Pitampura (PP)",
  "Rajouri Garden (RG)",
  "Preet Vihar (ED)",
  "Anand Vihar (AV)",
  "Gurgaon (GGN)",
  "Indirapuram (IPM)",
  "South Delhi (SD)",
  "Dwarka (DWK)",
  "Not a Student",
];

const posterImage = "/pinkd-event-poster.png";
const logoImage = "/pinkd-logo.png";
const brandName = "PINK'D";
const brandColor = "#ff007f";
const eventDateLabel = "11 SEPTEMBER";
const eventVenueLabel = "GLASS VILLA, GURGAON";
const eventDirectionsUrl = "https://www.google.com/maps/search/?api=1&query=Glass%20Villa%20Gurgaon";
const cashfreeScriptId = "cashfree-checkout-js";
const razorpayScriptId = "razorpay-checkout-js";

type CashfreeMode = "sandbox" | "production";
type PaymentProvider = "cashfree" | "razorpay";

type CashfreeCheckout = {
  checkout: (options: { paymentSessionId: string; redirectTarget: "_modal" | "_self" | "_blank" | "_top" }) => Promise<unknown>;
};

type RazorpayCheckoutResponse = {
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

function loadCashfreeSdk() {
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

function loadRazorpaySdk() {
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

function openRazorpayCheckout(paymentData: {
  key_id: string;
  amount_paise: number;
  currency: string;
  razorpay_order_id: string;
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
      name: brandName,
      description: "PINK'D event booking",
      order_id: paymentData.razorpay_order_id,
      prefill: {
        name: paymentData.customer.name,
        email: paymentData.customer.email,
        contact: paymentData.customer.phone,
      },
      theme: {
        color: brandColor,
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

function waitForCheckoutSurface(provider: PaymentProvider, timeoutMs = 12000) {
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

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function waitForSheetCloseAnimation() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 360));
}

function getGatewayLabel(provider: PaymentProvider) {
  return provider === "razorpay" ? "Razorpay" : "Cashfree";
}

function getPaymentErrorMessage(error: unknown, provider?: PaymentProvider) {
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

async function getFunctionErrorMessage(error: unknown, data: unknown) {
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

function createCheckoutToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getCategoryTone(category: EventPackageOption["category"]) {
  switch (category) {
    case "intensives":
      return "border-primary/35 bg-primary/10";
    case "party":
      return "border-fuchsia-300/35 bg-fuchsia-400/10";
    case "package":
      return "border-amber-200/40 bg-amber-300/10";
    case "group":
      return "border-cyan-200/35 bg-cyan-300/10";
  }
}

function getCategoryAnchor(category: EventPackageOption["category"]) {
  switch (category) {
    case "intensives":
      return "intensives";
    case "party":
      return "party";
    case "package":
      return "packages";
    case "group":
      return "group-packages";
  }
}

function getSlotSummary(selectedTimeSlots: string[], intensiveCount?: number) {
  if (!intensiveCount) return "No slot selection needed";
  if (selectedTimeSlots.length === 0) return "Select time slots";
  if (selectedTimeSlots.length === EVENT_TIME_SLOTS.length) return "All 4 slots selected";
  return `${selectedTimeSlots.length} selected`;
}

function makeCartLineId(packageId: string, selectedTimeSlots: string[]) {
  return `${packageId}:${selectedTimeSlots.join("|")}`;
}

export default function EventLanding() {
  const { toast } = useToast();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [coinCart, setCoinCart] = useState<CoinCartItem[]>([]);
  const [form, setForm] = useState<CheckoutFormState>(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    id: string;
    total: number;
    status: "paid" | "pending";
    customerEmail: string;
    purchasedItems?: string;
    confirmationEmailSent?: boolean;
    confirmationEmailError?: string | null;
  } | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<EventPackageOption | null>(null);
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [eventOptions, setEventOptions] = useState<EventPackageOption[]>(EVENT_PACKAGE_OPTIONS);
  const [coinPackages, setCoinPackages] = useState<CoinPackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [coinPackagesLoading, setCoinPackagesLoading] = useState(true);
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>("cashfree");
  const [paymentSettingsLoading, setPaymentSettingsLoading] = useState(true);
  const [isGatewayActive, setIsGatewayActive] = useState(false);
  const [isGatewayOpening, setIsGatewayOpening] = useState(false);
  const [selectedGroupPackageId, setSelectedGroupPackageId] = useState("");
  const viewContentTrackedRef = useRef(false);

  const fetchEventConfig = useCallback(async () => {
    try {
      setPackagesLoading(true);
      setCoinPackagesLoading(true);
      setPaymentSettingsLoading(true);

      const [packageResult, coinPackageResult, paymentSettingResult] = await Promise.all([
        supabase
          .from("event_packages")
          .select("*")
          .eq("active", true)
          .order("display_order", { ascending: true }),
        supabase
          .from("coin_packages")
          .select("id, inr_amount, coin_amount, active, display_order")
          .eq("active", true)
          .order("display_order", { ascending: true }),
        supabase
          .from("payment_gateway_settings")
          .select("active_provider")
          .eq("id", "event_bookings")
          .single(),
      ]);

      if (packageResult.error) throw packageResult.error;
      if (coinPackageResult.error) throw coinPackageResult.error;
      if (paymentSettingResult.error) throw paymentSettingResult.error;

      setEventOptions((packageResult.data || []).length > 0 ? packageResult.data.map(normalizeEventPackage) : EVENT_PACKAGE_OPTIONS);
      setCoinPackages((coinPackageResult.data || []).map((coinPackage) => ({
        id: coinPackage.id,
        inr_amount: Number(coinPackage.inr_amount),
        coin_amount: Number(coinPackage.coin_amount),
        active: Boolean(coinPackage.active),
        display_order: Number(coinPackage.display_order),
      })));
      setPaymentProvider(paymentSettingResult.data?.active_provider === "razorpay" ? "razorpay" : "cashfree");
    } catch (error) {
      console.error("Event config load failed:", error);
      setEventOptions(EVENT_PACKAGE_OPTIONS);
      setCoinPackages([]);
      setPaymentProvider("cashfree");
    } finally {
      setPackagesLoading(false);
      setCoinPackagesLoading(false);
      setPaymentSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEventConfig();
  }, [fetchEventConfig]);

  useEffect(() => {
    captureLandingAttribution();
  }, []);

  const groupedOptions = useMemo(
    () =>
      eventOptions.reduce(
        (groups, option) => {
          groups[option.category].push(option);
          return groups;
        },
        {
          intensives: [] as EventPackageOption[],
          party: [] as EventPackageOption[],
          package: [] as EventPackageOption[],
          group: [] as EventPackageOption[],
        },
      ),
    [eventOptions],
  );

  const fullPassOption = groupedOptions.package.find((option) => option.id === "four-intensives-party") || groupedOptions.package[0];
  const fourIntensiveOption = groupedOptions.intensives.find((option) => option.id === "four-intensives");
  const partyOption = groupedOptions.party.find((option) => option.id === "party-entry") || groupedOptions.party[0];
  const fullPassSeparateTotal = (fourIntensiveOption?.priceInr || 0) + (partyOption?.priceInr || 0);
  const fullPassSavings = fullPassOption ? Math.max(0, fullPassSeparateTotal - fullPassOption.priceInr) : 0;
  const selectedGroupOption =
    groupedOptions.group.find((option) => option.id === selectedGroupPackageId) || groupedOptions.group[0];

  useEffect(() => {
    if (!selectedGroupPackageId && groupedOptions.group[0]) {
      setSelectedGroupPackageId(groupedOptions.group[0].id);
    }
  }, [groupedOptions.group, selectedGroupPackageId]);

  const cartLines = useMemo(
    () =>
      cart
        .map((item) => {
          const option = eventOptions.find((eventOption) => eventOption.id === item.packageId);
          if (!option) return null;

          return {
            ...item,
            option,
            lineTotal: option.priceInr * item.quantity,
          };
        })
        .filter(Boolean) as Array<CartItem & { option: EventPackageOption; lineTotal: number }>,
    [cart, eventOptions],
  );

  const coinLines = useMemo(
    () =>
      coinCart
        .map((item) => {
          const option = coinPackages.find((coinPackage) => coinPackage.id === item.coinPackageId);
          if (!option) return null;

          return {
            ...item,
            option,
            lineTotal: option.inr_amount * item.quantity,
            coinTotal: option.coin_amount * item.quantity,
          };
        })
        .filter(Boolean) as Array<CoinCartItem & { option: CoinPackage; lineTotal: number; coinTotal: number }>,
    [coinCart, coinPackages],
  );

  const eventSubtotal = cartLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const coinSubtotal = coinLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const coinsToReceive = coinLines.reduce((sum, line) => sum + line.coinTotal, 0);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0) + coinLines.reduce((sum, line) => sum + line.quantity, 0);
  const grandTotal = eventSubtotal + coinSubtotal;
  const hasCheckoutItems = cartLines.length > 0 || coinLines.length > 0;
  const purchasedItemsSummary = useMemo(
    () =>
      [
        ...cartLines.map((line) => `${line.quantity} x ${line.option.name}`),
        ...coinLines.map((line) => `${line.quantity} x ${formatCoins(line.option.coin_amount)}`),
      ].join(", "),
    [cartLines, coinLines],
  );
  const trackingItems = useMemo<TrackingCartItem[]>(
    () => [
      ...cartLines.map((line) => ({
        item_id: line.packageId,
        item_name: line.option.name,
        item_category: line.option.category,
        price: line.option.priceInr,
        quantity: line.quantity,
      })),
      ...coinLines.map((line) => ({
        item_id: `coin-package:${line.coinPackageId}`,
        item_name: `${line.option.coin_amount} Pink'D Coins`,
        item_category: "coins",
        price: line.option.inr_amount,
        quantity: line.quantity,
      })),
    ],
    [cartLines, coinLines],
  );

  useEffect(() => {
    if (!eventOptions.length || viewContentTrackedRef.current) return;
    viewContentTrackedRef.current = true;

    trackViewContent({
      value: Math.min(...eventOptions.map((option) => option.priceInr)),
      items: eventOptions.map((option) => ({
        item_id: option.id,
        item_name: option.name,
        item_category: option.category,
        price: option.priceInr,
        quantity: 1,
      })),
    });
  }, [eventOptions]);

  const openPackageModal = (option: EventPackageOption) => {
    setConfirmedOrder(null);
    setSelectedPackage(option);
    setPendingSlots(getDefaultTimeSlots(option));
    setIsPackageModalOpen(true);
  };

  const togglePendingSlot = (slot: string) => {
    if (!selectedPackage?.intensiveCount || selectedPackage.intensiveCount >= EVENT_TIME_SLOTS.length) return;

    const selected = pendingSlots.includes(slot);
    if (selected) {
      setPendingSlots((current) => current.filter((timeSlot) => timeSlot !== slot));
      return;
    }

    if (pendingSlots.length >= selectedPackage.intensiveCount) {
      toast({
        title: "Too Many Time Slots",
        description: `This package allows ${selectedPackage.intensiveCount} time slot${selectedPackage.intensiveCount === 1 ? "" : "s"}. Please adjust your selection or upgrade your package.`,
        variant: "destructive",
      });
      return;
    }

    setPendingSlots((current) => [...current, slot]);
  };

  const confirmAddToCart = () => {
    if (!selectedPackage) return;

    const allowedSlots = selectedPackage.intensiveCount || 0;
    const selectedTimeSlots = allowedSlots >= EVENT_TIME_SLOTS.length ? EVENT_TIME_SLOTS : pendingSlots;

    if (allowedSlots === 1 && selectedTimeSlots.length !== 1) {
      toast({
        title: "Select 1 Time Slot",
        description: "This package needs exactly 1 time slot. Please adjust your selection or upgrade your package.",
        variant: "destructive",
      });
      return;
    }

    if (allowedSlots === 2 && (selectedTimeSlots.length < 1 || selectedTimeSlots.length > 2)) {
      toast({
        title: "Adjust Time Slots",
        description: "This package allows up to 2 time slots. Please adjust your selection or upgrade your package.",
        variant: "destructive",
      });
      return;
    }

    const lineId = makeCartLineId(selectedPackage.id, selectedTimeSlots);

    setCart((current) => {
      const existing = current.find((item) => item.id === lineId);
      if (existing) {
        return current.map((item) =>
          item.id === lineId ? { ...item, quantity: Math.min(item.quantity + 1, 100) } : item,
        );
      }

      return [
        ...current,
        {
          id: lineId,
          packageId: selectedPackage.id,
          quantity: 1,
          selectedTimeSlots,
        },
      ];
    });

    setIsPackageModalOpen(false);
    setIsCartOpen(true);
  };

  const updateQuantity = (cartItemId: string, quantity: number) => {
    setConfirmedOrder(null);
    setCart((current) =>
      current
        .map((item) => (item.id === cartItemId ? { ...item, quantity: Math.max(0, Math.min(quantity, 100)) } : item))
        .filter((item) => item.quantity > 0),
    );
  };

  const addCoinPackage = (coinPackageId: string) => {
    setConfirmedOrder(null);
    setCoinCart((current) => {
      const existing = current.find((item) => item.coinPackageId === coinPackageId);
      if (existing) {
        return current.map((item) =>
          item.coinPackageId === coinPackageId
            ? { ...item, quantity: Math.min(item.quantity + 1, 100) }
            : item,
        );
      }

      return [
        ...current,
        {
          id: `coin:${coinPackageId}`,
          coinPackageId,
          quantity: 1,
        },
      ];
    });
  };

  const updateCoinQuantity = (cartItemId: string, quantity: number) => {
    setConfirmedOrder(null);
    setCoinCart((current) =>
      current
        .map((item) => (item.id === cartItemId ? { ...item, quantity: Math.max(0, Math.min(quantity, 100)) } : item))
        .filter((item) => item.quantity > 0),
    );
  };

  const removeCoinFromCart = (cartItemId: string) => {
    setConfirmedOrder(null);
    setCoinCart((current) => current.filter((item) => item.id !== cartItemId));
  };

  const removeFromCart = (cartItemId: string) => {
    setConfirmedOrder(null);
    setCart((current) => current.filter((item) => item.id !== cartItemId));
  };

  const updateField = (field: keyof CheckoutFormState, value: string) => {
    setConfirmedOrder(null);
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasCheckoutItems) {
      toast({
        title: "Cart Is Empty",
        description: "Add at least one Pink'D event option or coin package before checkout.",
        variant: "destructive",
      });
      return;
    }

    if (!form.name.trim() || !form.phone.trim() || !form.email.trim() || !form.studio) {
      toast({
        title: "Details Required",
        description: "Please add your name, phone, email, and studio to reserve your cart.",
        variant: "destructive",
      });
      return;
    }

    flushSync(() => {
      setIsSubmitting(true);
      setIsCartOpen(false);
      setIsGatewayActive(true);
      setIsGatewayOpening(true);
    });
    await waitForSheetCloseAnimation();

    try {
      const checkoutToken = createCheckoutToken();
      const checkoutTokenHash = await sha256Hex(checkoutToken);
      const { data, error } = await supabase
        .rpc("create_event_order_checkout", {
          p_customer_name: form.name.trim(),
          p_customer_phone: form.phone.trim(),
          p_customer_email: form.email.trim(),
          p_customer_studio: form.studio,
          p_checkout_token_hash: checkoutTokenHash,
          p_attribution: getLandingAttribution(),
          p_cart_items: [
            ...cartLines.map((line) => ({
              item_type: "event_package",
              package_key: line.packageId,
              quantity: line.quantity,
              selected_time_slots: line.selectedTimeSlots,
            })),
            ...coinLines.map((line) => ({
              item_type: "coin_package",
              coin_package_id: line.coinPackageId,
              package_key: `coin-package:${line.coinPackageId}`,
              quantity: line.quantity,
              selected_time_slots: [],
            })),
          ],
        })
        .single();

      if (error) throw error;

      const orderId = data.order_id;
      const orderTotal = Number(data.total_amount_inr);
      let paymentFlowCompleted = false;
      let attemptedPaymentProvider = paymentProvider;

      try {
        const { data: paymentData, error: paymentError } = await supabase.functions.invoke("event-payment-create", {
          body: { event_order_id: orderId, checkout_token: checkoutToken },
        });

        if (paymentData?.provider === "cashfree" || paymentData?.provider === "razorpay") {
          attemptedPaymentProvider = paymentData.provider;
        }

        trackInitiateCheckout({
          orderId,
          value: orderTotal,
          items: trackingItems,
          paymentProvider: attemptedPaymentProvider,
        });

        if (paymentError) throw new Error(await getFunctionErrorMessage(paymentError, paymentData));

        if (paymentData?.provider === "razorpay") {
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
            customer: paymentData?.customer || {
              name: form.name.trim(),
              email: form.email.trim(),
              phone: form.phone.trim(),
            },
          }, () => setIsGatewayOpening(false));

          if (!checkoutResponse) {
            throw new Error("Razorpay checkout was closed before payment completed");
          }

          const { data: verificationData, error: verificationError } = await supabase.functions.invoke(
            "event-payment-verify",
            {
              body: {
                provider: "razorpay",
                event_order_id: orderId,
                checkout_token: checkoutToken,
                razorpay_order_id: checkoutResponse.razorpay_order_id,
                razorpay_payment_id: checkoutResponse.razorpay_payment_id,
                razorpay_signature: checkoutResponse.razorpay_signature,
              },
            },
          );

          if (verificationError) throw new Error(await getFunctionErrorMessage(verificationError, verificationData));

          const isPaid = verificationData?.payment_status === "paid";
          const confirmationEmailSent = Boolean(verificationData?.confirmation_email_sent);
          const confirmationEmailError = verificationData?.confirmation_email_error
            ? String(verificationData.confirmation_email_error)
            : null;
          setConfirmedOrder({
            id: orderId,
            total: orderTotal,
            status: isPaid ? "paid" : "pending",
            customerEmail: form.email.trim(),
            purchasedItems: purchasedItemsSummary,
            confirmationEmailSent,
            confirmationEmailError,
          });
          if (isPaid) {
            trackPurchaseOnce({
              orderId,
              value: orderTotal,
              items: trackingItems,
              paymentProvider: "razorpay",
            });
            trackLeadOnce({
              orderId,
              value: orderTotal,
              items: trackingItems,
              paymentProvider: "razorpay",
            });
          }
          toast({
            title: isPaid ? "Payment Confirmed" : "Payment Pending",
            description: isPaid
              ? confirmationEmailSent
                ? `Your Pink'D event booking is confirmed. Confirmation email sent to ${form.email.trim()}.`
                : `Your Pink'D event booking is confirmed.${confirmationEmailError ? ` Email could not be sent: ${confirmationEmailError}` : ""}`
              : "Your order is saved, but Razorpay has not confirmed capture yet.",
          });
          paymentFlowCompleted = true;
        } else {
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
            if (isVisible) setIsGatewayOpening(false);
          });
          await cashfree.checkout({
            paymentSessionId,
            redirectTarget: "_modal",
          });

          const { data: verificationData, error: verificationError } = await supabase.functions.invoke(
            "event-payment-verify",
            {
              body: {
                provider: "cashfree",
                event_order_id: orderId,
                checkout_token: checkoutToken,
                cashfree_order_id: cashfreeOrderId,
              },
            },
          );

          if (verificationError) throw new Error(await getFunctionErrorMessage(verificationError, verificationData));

          const isPaid = verificationData?.payment_status === "paid";
          const confirmationEmailSent = Boolean(verificationData?.confirmation_email_sent);
          const confirmationEmailError = verificationData?.confirmation_email_error
            ? String(verificationData.confirmation_email_error)
            : null;
          setConfirmedOrder({
            id: orderId,
            total: orderTotal,
            status: isPaid ? "paid" : "pending",
            customerEmail: form.email.trim(),
            purchasedItems: purchasedItemsSummary,
            confirmationEmailSent,
            confirmationEmailError,
          });
          if (isPaid) {
            trackPurchaseOnce({
              orderId,
              value: orderTotal,
              items: trackingItems,
              paymentProvider: "cashfree",
            });
            trackLeadOnce({
              orderId,
              value: orderTotal,
              items: trackingItems,
              paymentProvider: "cashfree",
            });
          }
          toast({
            title: isPaid ? "Payment Confirmed" : "Payment Pending",
            description: isPaid
              ? confirmationEmailSent
                ? `Your Pink'D event booking is confirmed. Confirmation email sent to ${form.email.trim()}.`
                : `Your Pink'D event booking is confirmed.${confirmationEmailError ? ` Email could not be sent: ${confirmationEmailError}` : ""}`
              : "Your order is saved, but Cashfree has not confirmed payment yet.",
          });
          paymentFlowCompleted = true;
        }
      } catch (paymentError) {
        console.error("Event payment setup failed:", paymentError);
        setConfirmedOrder({
          id: orderId,
          total: orderTotal,
          status: "pending",
          customerEmail: form.email.trim(),
          purchasedItems: purchasedItemsSummary,
        });
        setIsCartOpen(true);
        toast({
          title: "Payment Setup Failed",
          description: getPaymentErrorMessage(paymentError, attemptedPaymentProvider),
          variant: "destructive",
        });
      }

      if (paymentFlowCompleted) {
        setIsCartOpen(true);
        setCart([]);
        setCoinCart([]);
        setForm(initialFormState);
      }
    } catch (error) {
      console.error("Event order creation failed:", error);
      toast({
        title: "Order Failed",
        description: "Could not reserve this cart. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGatewayOpening(false);
      setIsGatewayActive(false);
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050307] pb-24 text-white">
      <section className="border-b border-white/10">
        <div className="mx-auto max-w-7xl px-5 py-5 sm:px-8 lg:px-10">
          <nav className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={logoImage} alt="Pink'D" className="h-11 w-auto max-w-[9.5rem] object-contain" />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsCartOpen(true)}
              className="border-white/15 bg-white/[0.06] text-white hover:bg-white/10 hover:text-white"
            >
              <ShoppingBag className="mr-2 h-4 w-4 text-primary" />
              Cart
              {cartCount > 0 ? <span className="ml-2 text-primary">{cartCount}</span> : null}
            </Button>
          </nav>

          <div className="grid gap-8 py-8 lg:grid-cols-[1fr_24rem] lg:items-end lg:py-12">
            <div>
              <Badge className="mb-5 border border-primary/35 bg-primary/15 text-white hover:bg-primary/20">
                <Ticket className="mr-2 h-3.5 w-3.5" />
                {eventDateLabel}
              </Badge>
              <h1 className="max-w-3xl text-5xl font-black leading-none sm:text-7xl lg:text-8xl">
                PINK'D
                <span className="block text-primary">EVENT PASSES</span>
              </h1>
              <div className="mt-5 flex flex-wrap gap-2 text-sm font-bold uppercase text-white/78">
                <span className="inline-flex items-center rounded-md border border-white/12 bg-white/[0.06] px-3 py-2">
                  <CalendarDays className="mr-2 h-4 w-4 text-primary" />
                  11 September
                </span>
                <a
                  href={eventDirectionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-md border border-white/12 bg-white/[0.06] px-3 py-2 transition hover:border-primary/45 hover:text-primary"
                >
                  <MapPin className="mr-2 h-4 w-4 text-primary" />
                  {eventVenueLabel}
                </a>
              </div>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/68 sm:text-lg">
                Pick passes, add Pink'D Coins for games at the party, and pay in INR. Event bookings stay separate from NFC wallet balances.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wide">
                <a href="#party" className="rounded-md border border-white/12 px-3 py-2 text-white/74 transition hover:border-primary/45 hover:text-primary">Party</a>
                <a href="#full-pass" className="rounded-md border border-primary/45 bg-primary/12 px-3 py-2 text-white transition hover:bg-primary/20">Full Pass</a>
                <a href="#intensives" className="rounded-md border border-white/12 px-3 py-2 text-white/74 transition hover:border-primary/45 hover:text-primary">Intensives</a>
                <a href="#groups" className="rounded-md border border-white/12 px-3 py-2 text-white/74 transition hover:border-primary/45 hover:text-primary">Groups</a>
                <a href="#faq" className="rounded-md border border-white/12 px-3 py-2 text-white/74 transition hover:border-primary/45 hover:text-primary">FAQ</a>
              </div>
            </div>

            {fullPassOption ? (
              <div id="full-pass" className="rounded-lg border border-primary/45 bg-primary/12 p-5 shadow-[0_0_42px_rgba(255,0,127,0.18)]">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-primary">
                  <Sparkles className="h-4 w-4" />
                  Best value
                </div>
                <div className="mt-3 text-2xl font-black">{fullPassOption.name}</div>
                <p className="mt-2 text-sm leading-6 text-white/68">{fullPassOption.description}</p>
                <div className="mt-5 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-4xl font-black text-primary">{formatEventPrice(fullPassOption.priceInr)}</div>
                    {fullPassSavings > 0 ? (
                      <div className="mt-1 text-sm text-white/62">
                        Save {formatEventPrice(fullPassSavings)} vs buying separately
                      </div>
                    ) : null}
                  </div>
                  <Button type="button" onClick={() => openPackageModal(fullPassOption)} className="bg-primary text-black hover:bg-primary/90">
                    Book Now
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section id="book" className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-10">
        <div className="space-y-8">
          {packagesLoading ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm text-white/58">
              Loading available packages...
            </div>
          ) : null}
          {selectedGroupOption ? (
            <div id="groups" className="rounded-lg border border-white/12 bg-white/[0.04] p-4 sm:p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-primary">
                    <Users className="h-4 w-4" />
                    Group deal picker
                  </div>
                  <h2 className="mt-2 text-2xl font-black">Bring the whole crew</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/62">
                    Choose a group pass and see the total, per-person price, and value before adding it to cart.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:w-[28rem]">
                  {groupedOptions.group.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSelectedGroupPackageId(option.id)}
                      className={`rounded-lg border p-3 text-left transition ${
                        selectedGroupOption.id === option.id
                          ? "border-primary bg-primary/15 text-white"
                          : "border-white/12 bg-black/30 text-white/70 hover:border-primary/45"
                      }`}
                    >
                      <div className="text-sm font-black">{option.pax} Pax</div>
                      <div className="mt-1 text-xs">{formatEventPrice(option.priceInr)}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                  <div className="text-xs uppercase text-white/45">Total</div>
                  <div className="mt-1 text-xl font-black text-primary">{formatEventPrice(selectedGroupOption.priceInr)}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                  <div className="text-xs uppercase text-white/45">Per person</div>
                  <div className="mt-1 text-xl font-black">
                    {formatEventPrice(Math.round(selectedGroupOption.priceInr / Math.max(selectedGroupOption.pax || 1, 1)))}
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={() => openPackageModal(selectedGroupOption)}
                  className="h-full min-h-16 bg-primary text-base font-black text-black hover:bg-primary/90"
                >
                  Add Group Pass
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
          {(Object.keys(groupedOptions) as Array<keyof typeof groupedOptions>).map((category) => (
            <div key={category} id={getCategoryAnchor(category)} className="scroll-mt-24 space-y-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-white/58">{EVENT_CATEGORY_LABELS[category]}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {groupedOptions[category].map((option) => (
                  <article
                    key={option.id}
                    className={`rounded-lg border p-4 transition hover:-translate-y-0.5 hover:border-primary/65 ${getCategoryTone(option.category)}`}
                  >
                    <div className="flex min-h-20 items-start justify-between gap-3">
                      <div>
                        <div className="font-bold">{option.name}</div>
                        <p className="mt-1 text-sm leading-5 text-white/58">{option.description}</p>
                      </div>
                      {option.featured ? <Sparkles className="h-4 w-4 shrink-0 text-amber-300" /> : null}
                    </div>
                    <div className="mt-5 flex items-end justify-between gap-3">
                      <div>
                        <div className="text-2xl font-black text-primary">{formatEventPrice(option.priceInr)}</div>
                        {option.pax ? <div className="mt-1 text-xs text-white/50">{option.pax} pax</div> : null}
                      </div>
                      <Button type="button" onClick={() => openPackageModal(option)} className="bg-primary text-black hover:bg-primary/90">
                        <Plus className="mr-2 h-4 w-4" />
                        Add to Cart
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Dialog open={isPackageModalOpen} onOpenChange={setIsPackageModalOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-white/12 bg-[#0b070f] p-0 text-white sm:max-w-2xl">
          {selectedPackage ? (
            <div className="grid gap-0 sm:grid-cols-[13rem_1fr]">
              <div className="bg-black/55 p-5">
                <img
                  src={posterImage}
                  alt="Pink'D event poster"
                  className="mx-auto aspect-square w-32 rounded-lg object-contain sm:w-full"
                />
              </div>
              <div className="p-5 sm:p-6">
                <DialogHeader>
                  <Badge className="w-fit border border-primary/35 bg-primary/15 text-white hover:bg-primary/20">
                    {EVENT_CATEGORY_LABELS[selectedPackage.category]}
                  </Badge>
                  <DialogTitle className="text-2xl font-black text-white">{selectedPackage.name}</DialogTitle>
                  <DialogDescription className="text-white/62">{selectedPackage.description}</DialogDescription>
                </DialogHeader>

                <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm text-white/56">Package price</div>
                      <div className="mt-1 text-3xl font-black text-primary">{formatEventPrice(selectedPackage.priceInr)}</div>
                    </div>
                    {selectedPackage.pax ? <Badge className="bg-white/10 text-white hover:bg-white/15">{selectedPackage.pax} pax</Badge> : null}
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  <Label className="text-white/80">Time Slots</Label>
                  {selectedPackage.intensiveCount ? (
                    <>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={selectedPackage.intensiveCount >= EVENT_TIME_SLOTS.length}>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-auto min-h-11 w-full justify-between border-white/12 bg-black/35 px-3 py-2 text-left text-white hover:bg-white/10 hover:text-white disabled:opacity-100"
                          >
                            <span className="min-w-0 truncate">
                              {getSlotSummary(pendingSlots, selectedPackage.intensiveCount)}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-white/45" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-72">
                          <DropdownMenuLabel>
                            {selectedPackage.intensiveCount === 1
                              ? "Select exactly 1 slot"
                              : `Select up to ${selectedPackage.intensiveCount} slots`}
                          </DropdownMenuLabel>
                          {EVENT_TIME_SLOTS.map((slot) => (
                            <DropdownMenuCheckboxItem
                              key={slot}
                              checked={pendingSlots.includes(slot)}
                              onCheckedChange={() => togglePendingSlot(slot)}
                              onSelect={(event) => event.preventDefault()}
                            >
                              {slot}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {selectedPackage.intensiveCount >= EVENT_TIME_SLOTS.length ? (
                        <div className="space-y-2">
                          <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/62">
                            All 4 slots are pre-selected and locked for this package.
                          </div>
                          <div className="space-y-1">
                            {pendingSlots.map((slot) => (
                              <div key={slot} className="rounded-md bg-white/[0.05] px-3 py-2 text-sm text-white/72">
                                {slot}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : pendingSlots.length > 0 ? (
                        <div className="space-y-1">
                          {pendingSlots.map((slot) => (
                            <div key={slot} className="rounded-md bg-white/[0.05] px-3 py-2 text-sm text-white/72">
                              {slot}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-white/52">Choose your preferred intensive time slot.</div>
                      )}
                    </>
                  ) : (
                    <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/62">
                      This package does not require a time-slot selection.
                    </div>
                  )}
                </div>

                <DialogFooter className="mt-6">
                  <Button
                    type="button"
                    onClick={confirmAddToCart}
                    className="h-11 w-full bg-primary font-bold text-black hover:bg-primary/90 sm:w-auto"
                  >
                    Confirm & Add to Cart
                  </Button>
                </DialogFooter>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Sheet open={isCartOpen && !isGatewayActive} onOpenChange={setIsCartOpen}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto border-white/12 bg-[#0b070f] p-5 text-white sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-white">
              <ShoppingBag className="h-5 w-5 text-primary" />
              Cart
            </SheetTitle>
            <SheetDescription className="text-white/58">
              Review items, quantities, and INR total before reserving.
            </SheetDescription>
          </SheetHeader>

          {confirmedOrder ? (
            <div className="mt-5 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                {confirmedOrder.status === "paid" ? "Payment confirmed" : "Order saved"}
              </div>
              <div className="mt-1 text-success/85">
                Ref {confirmedOrder.id.slice(0, 8).toUpperCase()} · {formatEventPrice(confirmedOrder.total)}
              </div>
              <div className="mt-2 space-y-1 text-success/85">
                {confirmedOrder.purchasedItems ? <div>{confirmedOrder.purchasedItems}</div> : null}
                <div>{eventDateLabel} · {eventVenueLabel}</div>
                <a
                  href={eventDirectionsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
                >
                  Get directions
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              </div>
              {confirmedOrder.status === "paid" ? (
                <div className="mt-1 text-success/85">
                  {confirmedOrder.confirmationEmailSent
                    ? `Confirmation email sent to ${confirmedOrder.customerEmail}.`
                    : confirmedOrder.confirmationEmailError
                      ? `Payment is confirmed, but email failed: ${confirmedOrder.confirmationEmailError}`
                      : "Payment is confirmed. Confirmation email will be sent shortly."}
                </div>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-5 flex flex-1 flex-col">
            <div className="space-y-3">
              {cartLines.length === 0 && coinLines.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm text-white/58">
                  Your cart is empty.
                </div>
              ) : (
                cartLines.map((line) => (
                  <div key={line.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{line.option.name}</div>
                        <div className="mt-1 text-xs text-white/52">
                          {formatEventPrice(line.option.priceInr)} each
                          {line.option.pax ? ` · ${line.option.pax} pax` : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(line.id)}
                        className="rounded-md p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
                        aria-label={`Remove ${line.option.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {line.selectedTimeSlots.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {line.selectedTimeSlots.map((slot) => (
                          <div key={slot} className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-white/70">
                            {slot}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex h-9 items-center rounded-md border border-white/12 bg-black/35">
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.id, line.quantity - 1)}
                          className="grid h-9 w-9 place-items-center text-white/70 hover:text-white"
                          aria-label={`Decrease ${line.option.name}`}
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-9 text-center text-sm font-bold">{line.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.id, line.quantity + 1)}
                          className="grid h-9 w-9 place-items-center text-white/70 hover:text-white"
                          aria-label={`Increase ${line.option.name}`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="font-black text-primary">{formatEventPrice(line.lineTotal)}</div>
                    </div>
                  </div>
                ))
              )}

              {coinLines.map((line) => (
                <div key={line.id} className="rounded-lg border border-primary/25 bg-primary/10 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-semibold">
                        <Coins className="h-4 w-4 text-primary" />
                        {formatCoins(line.option.coin_amount)}
                      </div>
                      <div className="mt-1 text-xs text-white/58">
                        {formatEventPrice(line.option.inr_amount)} each
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCoinFromCart(line.id)}
                      className="rounded-md p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
                      aria-label={`Remove ${formatCoins(line.option.coin_amount)}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex h-9 items-center rounded-md border border-white/12 bg-black/35">
                      <button
                        type="button"
                        onClick={() => updateCoinQuantity(line.id, line.quantity - 1)}
                        className="grid h-9 w-9 place-items-center text-white/70 hover:text-white"
                        aria-label={`Decrease ${formatCoins(line.option.coin_amount)}`}
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-9 text-center text-sm font-bold">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateCoinQuantity(line.id, line.quantity + 1)}
                        className="grid h-9 w-9 place-items-center text-white/70 hover:text-white"
                        aria-label={`Increase ${formatCoins(line.option.coin_amount)}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="font-black text-primary">{formatEventPrice(line.lineTotal)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-primary/30 bg-primary/10 p-4">
              <div className="flex items-start gap-3">
                <Coins className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <div className="font-black">Say hi to your Pink'D currency</div>
                  <p className="mt-1 text-sm leading-5 text-white/68">
                    Pink'D Coins can be used to play games at the party. Pick a coin pack below and it will be added to your total payable.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {coinPackagesLoading ? (
                  <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white/58">
                    Loading Pink'D Coin packs...
                  </div>
                ) : coinPackages.length === 0 ? (
                  <div className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white/58">
                    Pink'D Coin packs are not available right now.
                  </div>
                ) : (
                  coinPackages.map((coinPackage) => {
                    const selectedCoinLine = coinLines.find((line) => line.coinPackageId === coinPackage.id);

                    return (
                      <div
                        key={coinPackage.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/25 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-bold">{formatCoins(coinPackage.coin_amount)}</div>
                          <div className="text-xs text-white/52">{formatEventPrice(coinPackage.inr_amount)}</div>
                        </div>
                        {selectedCoinLine ? (
                          <div className="flex h-8 items-center rounded-md border border-white/12 bg-black/35">
                            <button
                              type="button"
                              onClick={() => updateCoinQuantity(selectedCoinLine.id, selectedCoinLine.quantity - 1)}
                              className="grid h-8 w-8 place-items-center text-white/70 hover:text-white"
                              aria-label={`Decrease ${formatCoins(coinPackage.coin_amount)}`}
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="w-8 text-center text-xs font-bold">{selectedCoinLine.quantity}</span>
                            <button
                              type="button"
                              onClick={() => updateCoinQuantity(selectedCoinLine.id, selectedCoinLine.quantity + 1)}
                              className="grid h-8 w-8 place-items-center text-white/70 hover:text-white"
                              aria-label={`Increase ${formatCoins(coinPackage.coin_amount)}`}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => addCoinPackage(coinPackage.id)}
                            className="h-8 bg-primary px-3 text-xs font-bold text-black hover:bg-primary/90"
                          >
                            Add
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
              <div className="flex items-center justify-between text-white/62">
                <span>Event passes</span>
                <span>{formatEventPrice(eventSubtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-white/62">
                <span>Pink'D Coins</span>
                <span>{formatEventPrice(coinSubtotal)}</span>
              </div>
              {coinsToReceive > 0 ? (
                <div className="flex items-center justify-between text-white/78">
                  <span>Coins to receive</span>
                  <span>{formatCoins(coinsToReceive)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between text-white/62">
                <span>Total Payable</span>
                <span>{formatEventPrice(grandTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-lg font-black">
                <span>Grand Total</span>
                <span className="text-primary">{formatEventPrice(grandTotal)}</span>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <div className="space-y-2">
                <Label htmlFor="event-name" className="text-white/80">Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    id="event-name"
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    className="border-white/15 bg-white/[0.08] pl-9 text-white placeholder:text-white/35"
                    placeholder="Full name"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-phone" className="text-white/80">Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    id="event-phone"
                    value={form.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                    className="border-white/15 bg-white/[0.08] pl-9 text-white placeholder:text-white/35"
                    placeholder="+91..."
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-email" className="text-white/80">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <Input
                    id="event-email"
                    type="email"
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    className="border-white/15 bg-white/[0.08] pl-9 text-white placeholder:text-white/35"
                    placeholder="you@email.com"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-white/80">Studio</Label>
                <Select value={form.studio} onValueChange={(value) => updateField("studio", value)}>
                  <SelectTrigger className="border-white/15 bg-white/[0.08] text-white">
                    <SelectValue placeholder="Select studio" />
                  </SelectTrigger>
                  <SelectContent>
                    {STUDIO_OPTIONS.map((studio) => (
                      <SelectItem key={studio} value={studio}>
                        {studio}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-5 rounded-md border border-primary/25 bg-primary/10 p-3 text-sm text-white/72">
              Payment is processed in INR with {getGatewayLabel(paymentProvider)}. Event booking revenue stays separate from NFC wallet balances.
            </div>

            <div className="mt-3 rounded-md border border-white/12 bg-black/35 p-3 text-sm font-bold uppercase leading-6 text-white/78">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <div>18+ event. Valid ID required at entry.</div>
                  <div>All bookings are non-refundable.</div>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting || !hasCheckoutItems}
              className="mt-5 h-12 w-full bg-primary text-base font-bold text-black hover:bg-primary/90"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {isSubmitting || paymentSettingsLoading
                ? `Opening ${getGatewayLabel(paymentProvider)}...`
                : `Pay with ${getGatewayLabel(paymentProvider)}`}
            </Button>

          </form>
        </SheetContent>
      </Sheet>

      {isGatewayOpening ? (
        <div className="fixed inset-0 z-[2147483646] grid place-items-center bg-black text-white">
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <div>
              <div className="text-lg font-bold">Opening secure checkout</div>
              <div className="mt-1 text-sm text-white/58">
                Please wait while {getGatewayLabel(paymentProvider)} loads.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <section id="faq" className="mx-auto max-w-7xl scroll-mt-24 px-5 pb-8 sm:px-8 lg:px-10">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <div className="font-black uppercase">Venue</div>
            <p className="mt-2 text-sm leading-6 text-white/62">
              {eventVenueLabel}. Use the directions link for navigation.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <div className="font-black uppercase">Payments</div>
            <p className="mt-2 text-sm leading-6 text-white/62">
              Prices are listed in INR. Bookings confirm only after the payment gateway verifies success.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <div className="font-black uppercase">Entry</div>
            <p className="mt-2 text-sm leading-6 text-white/62">
              18+ only. Carry a valid ID. All bookings are non-refundable.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-black/30">
        <div className="mx-auto grid max-w-7xl gap-5 px-5 py-7 text-sm text-white/58 sm:px-8 lg:grid-cols-[1.2fr_1fr] lg:px-10">
          <div>
            <div className="font-bold text-white">Pink'D event bookings</div>
            <p className="mt-2 max-w-2xl leading-6">
              Products and services are listed on this page with pricing in INR. Event passes, party entries, group bookings, and Pink'D Coin packs are billed in INR and remain separate from the NFC wallet ledger.
            </p>
          </div>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:justify-end" aria-label="Policy links">
            <Link className="transition hover:text-primary" to="/contact-us">Contact Us</Link>
            <Link className="transition hover:text-primary" to="/terms-and-conditions">Terms & Conditions</Link>
            <Link className="transition hover:text-primary" to="/refunds-cancellations">Refunds & Cancellations</Link>
          </nav>
        </div>
      </footer>

      <button
        type="button"
        onClick={() => {
          if (hasCheckoutItems) {
            setIsCartOpen(true);
            return;
          }

          document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-between rounded-lg border border-primary/35 bg-black/90 px-4 py-3 shadow-2xl backdrop-blur sm:left-auto sm:w-80"
      >
        <span className="flex items-center gap-2 font-bold">
          <ShoppingBag className="h-4 w-4 text-primary" />
          BOOK NOW
          {cartCount > 0 ? <span className="text-primary">({cartCount})</span> : null}
        </span>
        <span className="font-black text-primary">{formatEventPrice(grandTotal)}</span>
      </button>
    </main>
  );
}
