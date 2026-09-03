import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link } from "react-router-dom";
import {
  ArrowRight,
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
  Trash2,
  User,
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

type EventPricingPhase = {
  id: string;
  phase_key: string;
  name: string;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  display_order: number;
};

type EventPackagePhaseLimit = {
  id: string;
  phase_id: string;
  package_id: string;
  capacity: number;
  display_registration_boost: number;
  price_inr: number;
  active: boolean;
};

type PhasePackageStats = {
  phase_id: string;
  package_id: string;
  confirmed_quantity: number;
  pending_quantity: number;
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

const posterImage = "/media/hero-poster.jpg";
const logoImage = "/media/pinkd-logo.png";
const hashtagLogoImage = "/hashtaglogo.png";
const heroVideo = "/media/hero-reel.mp4";
const heroPoster = "/media/hero-poster.jpg";
const partyCardImage = "/media/party-card.jpg";
const brandName = "PINK'D";
const brandColor = "#ff007f";
const eventDateLabel = "11 SEPTEMBER";
const intensiveVenueLabel = "#HASHTAG RAJOURI GARDEN";
const intensiveDirectionsUrl = "https://share.google/YFUUQ85X3WYy0wVLE";
const partyVenueLabel = "GLASS VILLA, GURGAON";
const partyDirectionsUrl = "https://www.google.com/maps/search/?api=1&query=Glass%20Villa%20Gurgaon";
const cashfreeScriptId = "cashfree-checkout-js";
const razorpayScriptId = "razorpay-checkout-js";

const facultyCards = [
  {
    time: "Wed · 6:00 PM",
    names: "Shivek & Priyanshi",
    label: "Intensive 1",
    image: "/media/faculty-01.jpg",
  },
  {
    time: "Wed · 8:00 PM",
    names: "Tarun, Dhriti & Divija",
    label: "Intensive 2",
    image: "/media/faculty-02.jpg",
  },
  {
    time: "Thu · 6:00 PM",
    names: "Jahnvi & Rubani",
    label: "Intensive 3",
    image: "/media/faculty-03.jpg",
  },
  {
    time: "Thu · 8:00 PM",
    names: "Manas, Jhilmil & Ayushi",
    label: "Intensive 4",
    image: "/media/faculty-04.jpg",
  },
];

const legacyImages = [
  ["/media/legacy-2025.jpg", "Pink'D 2025"],
  ["/media/legacy-2024.jpg", "Pink'D 2024"],
  ["/media/legacy-2023.jpg", "Pink'D 2023"],
  ["/media/legacy-2022.jpg", "Pink'D 2022"],
  ["/media/legacy-2021.jpg", "Pink'D 2021"],
];

const galleryImages = Array.from({ length: 12 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return `/media/gallery-${number}.jpg`;
});

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

function findCurrentPhase(phases: EventPricingPhase[]) {
  const now = Date.now();
  return phases.find((phase) => {
    if (!phase.active) return false;
    const startsAt = phase.starts_at ? new Date(phase.starts_at).getTime() : -Infinity;
    const endsAt = phase.ends_at ? new Date(phase.ends_at).getTime() : Infinity;
    return startsAt <= now && now < endsAt;
  }) || null;
}

function formatPhaseEnd(value: string | null) {
  if (!value) return "while passes last";
  return new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
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

function packageIncludesIntensives(option: EventPackageOption) {
  return Boolean(option.intensiveCount) || option.category === "intensives" || option.category === "package" || option.category === "group";
}

function packageIncludesParty(option: EventPackageOption) {
  return option.category === "party" || option.category === "package" || option.category === "group";
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
    includesIntensives?: boolean;
    includesParty?: boolean;
    confirmationEmailSent?: boolean;
    confirmationEmailError?: string | null;
  } | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<EventPackageOption | null>(null);
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showBottomSticker, setShowBottomSticker] = useState(false);
  const [eventOptions, setEventOptions] = useState<EventPackageOption[]>(EVENT_PACKAGE_OPTIONS);
  const [coinPackages, setCoinPackages] = useState<CoinPackage[]>([]);
  const [pricingPhases, setPricingPhases] = useState<EventPricingPhase[]>([]);
  const [phaseLimits, setPhaseLimits] = useState<EventPackagePhaseLimit[]>([]);
  const [phaseStats, setPhaseStats] = useState<PhasePackageStats[]>([]);
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

      const [packageResult, coinPackageResult, paymentSettingResult, phaseResult, limitResult, statResult] = await Promise.all([
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
        supabase
          .from("event_pricing_phases")
          .select("id, phase_key, name, active, starts_at, ends_at, display_order")
          .eq("active", true)
          .order("display_order", { ascending: true }),
        supabase
          .from("event_package_phase_limits")
          .select("id, phase_id, package_id, capacity, display_registration_boost, price_inr, active")
          .eq("active", true),
        supabase.rpc("get_event_phase_package_stats"),
      ]);

      if (packageResult.error) throw packageResult.error;
      if (coinPackageResult.error) throw coinPackageResult.error;
      if (paymentSettingResult.error) throw paymentSettingResult.error;
      if (phaseResult.error) throw phaseResult.error;
      if (limitResult.error) throw limitResult.error;
      if (statResult.error) throw statResult.error;

      setEventOptions((packageResult.data || []).length > 0 ? packageResult.data.map(normalizeEventPackage) : EVENT_PACKAGE_OPTIONS);
      setCoinPackages((coinPackageResult.data || []).map((coinPackage) => ({
        id: coinPackage.id,
        inr_amount: Number(coinPackage.inr_amount),
        coin_amount: Number(coinPackage.coin_amount),
        active: Boolean(coinPackage.active),
        display_order: Number(coinPackage.display_order),
      })));
      setPricingPhases((phaseResult.data || []).map((phase) => ({
        id: phase.id,
        phase_key: phase.phase_key,
        name: phase.name,
        active: Boolean(phase.active),
        starts_at: phase.starts_at,
        ends_at: phase.ends_at,
        display_order: Number(phase.display_order),
      })));
      setPhaseLimits((limitResult.data || []).map((limit) => ({
        id: limit.id,
        phase_id: limit.phase_id,
        package_id: limit.package_id,
        capacity: Number(limit.capacity),
        display_registration_boost: Number(limit.display_registration_boost),
        price_inr: Number(limit.price_inr),
        active: Boolean(limit.active),
      })));
      setPhaseStats((statResult.data || []).map((stat) => ({
        phase_id: stat.phase_id,
        package_id: stat.package_id,
        confirmed_quantity: Number(stat.confirmed_quantity || 0),
        pending_quantity: Number(stat.pending_quantity || 0),
      })));
      setPaymentProvider(paymentSettingResult.data?.active_provider === "razorpay" ? "razorpay" : "cashfree");
    } catch (error) {
      console.error("Event config load failed:", error);
      setEventOptions(EVENT_PACKAGE_OPTIONS);
      setCoinPackages([]);
      setPricingPhases([]);
      setPhaseLimits([]);
      setPhaseStats([]);
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

  useEffect(() => {
    const updateBottomStickerVisibility = () => {
      setShowBottomSticker(window.scrollY > window.innerHeight * 0.55);
    };

    updateBottomStickerVisibility();
    window.addEventListener("scroll", updateBottomStickerVisibility, { passive: true });
    window.addEventListener("resize", updateBottomStickerVisibility);

    return () => {
      window.removeEventListener("scroll", updateBottomStickerVisibility);
      window.removeEventListener("resize", updateBottomStickerVisibility);
    };
  }, []);

  const activePhase = useMemo(() => findCurrentPhase(pricingPhases), [pricingPhases]);
  const activePhaseLimits = useMemo(
    () => phaseLimits.filter((limit) => activePhase && limit.phase_id === activePhase.id && limit.active),
    [activePhase, phaseLimits],
  );
  const activePhaseLimitMap = useMemo(() => {
    const map = new Map<string, EventPackagePhaseLimit>();
    activePhaseLimits.forEach((limit) => map.set(limit.package_id, limit));
    return map;
  }, [activePhaseLimits]);
  const phaseStatMap = useMemo(() => {
    const map = new Map<string, PhasePackageStats>();
    phaseStats.forEach((stat) => map.set(`${stat.phase_id}:${stat.package_id}`, stat));
    return map;
  }, [phaseStats]);
  const displayEventOptions = useMemo(
    () =>
      eventOptions
        .map((option) => {
          const phaseLimit = activePhaseLimitMap.get(option.id);
          if (activePhase && !phaseLimit) return null;
          return phaseLimit ? { ...option, priceInr: phaseLimit.price_inr } : option;
        })
        .filter(Boolean) as EventPackageOption[],
    [activePhase, activePhaseLimitMap, eventOptions],
  );

  const groupedOptions = useMemo(
    () =>
      displayEventOptions.reduce(
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
    [displayEventOptions],
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
          const option = displayEventOptions.find((eventOption) => eventOption.id === item.packageId);
          if (!option) return null;

          return {
            ...item,
            option,
            lineTotal: option.priceInr * item.quantity,
          };
        })
        .filter(Boolean) as Array<CartItem & { option: EventPackageOption; lineTotal: number }>,
    [cart, displayEventOptions],
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

  const getPhaseDisplayForPackage = useCallback(
    (packageId: string) => {
      if (!activePhase) return null;

      const limit = activePhaseLimitMap.get(packageId);
      if (!limit) return null;

      const stat = phaseStatMap.get(`${activePhase.id}:${packageId}`);
      const confirmed = Number(stat?.confirmed_quantity || 0);
      const pending = Number(stat?.pending_quantity || 0);
      const displayBoost = Number(limit.display_registration_boost || 0);
      const visibleCount = confirmed + displayBoost;
      const capacity = Number(limit.capacity || 0);
      const remaining = Math.max(capacity - confirmed - pending, 0);
      const progress = capacity > 0 ? Math.min(100, Math.round((visibleCount / capacity) * 100)) : 100;

      return {
        phaseName: activePhase.name,
        endsAt: activePhase.ends_at,
        confirmed,
        pending,
        displayBoost,
        visibleCount,
        capacity,
        remaining,
        progress,
      };
    },
    [activePhase, activePhaseLimitMap, phaseStatMap],
  );

  const renderUrgencyMeter = (packageId: string) => {
    const urgency = getPhaseDisplayForPackage(packageId);
    if (!urgency) return null;

    return (
      <div className="mt-3 rounded-md border border-primary/25 bg-black/35 p-3">
        <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wide text-white/58">
          <span>{urgency.phaseName}</span>
          <span>{urgency.remaining} left</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-primary" style={{ width: `${urgency.progress}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/58">
          <span>{urgency.visibleCount} people have picked this pass</span>
          <span>{urgency.pending} held</span>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!displayEventOptions.length || viewContentTrackedRef.current) return;
    viewContentTrackedRef.current = true;

    trackViewContent({
      value: Math.min(...displayEventOptions.map((option) => option.priceInr)),
      items: displayEventOptions.map((option) => ({
        item_id: option.id,
        item_name: option.name,
        item_category: option.category,
        price: option.priceInr,
        quantity: 1,
      })),
    });
  }, [displayEventOptions]);

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

    const orderIncludesIntensives = cartLines.some((line) => packageIncludesIntensives(line.option));
    const orderIncludesParty = cartLines.some((line) => packageIncludesParty(line.option));

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
          pricingPhase: activePhase?.phase_key || activePhase?.name,
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
            includesIntensives: orderIncludesIntensives,
            includesParty: orderIncludesParty,
            confirmationEmailSent,
            confirmationEmailError,
          });
          if (isPaid) {
            trackPurchaseOnce({
              orderId,
              value: orderTotal,
              items: trackingItems,
              paymentProvider: "razorpay",
              pricingPhase: activePhase?.phase_key || activePhase?.name,
            });
            trackLeadOnce({
              orderId,
              value: orderTotal,
              items: trackingItems,
              paymentProvider: "razorpay",
              pricingPhase: activePhase?.phase_key || activePhase?.name,
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
            includesIntensives: orderIncludesIntensives,
            includesParty: orderIncludesParty,
            confirmationEmailSent,
            confirmationEmailError,
          });
          if (isPaid) {
            trackPurchaseOnce({
              orderId,
              value: orderTotal,
              items: trackingItems,
              paymentProvider: "cashfree",
              pricingPhase: activePhase?.phase_key || activePhase?.name,
            });
            trackLeadOnce({
              orderId,
              value: orderTotal,
              items: trackingItems,
              paymentProvider: "cashfree",
              pricingPhase: activePhase?.phase_key || activePhase?.name,
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
          includesIntensives: orderIncludesIntensives,
          includesParty: orderIncludesParty,
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

  const attendeeCount = cartLines.reduce(
    (sum, line) => sum + Math.max(line.option.pax || 1, 1) * line.quantity,
    0,
  );
  const totalCartItems = cartLines.length + coinLines.length;
  const firstCartLine = cartLines[0] || null;
  const cartBannerTitle = totalCartItems === 0
    ? "Pick a pass"
    : totalCartItems === 1 && firstCartLine
      ? firstCartLine.option.name
      : `${totalCartItems} items selected`;
  const cartBannerSub = totalCartItems === 0
    ? "All passes are billed in INR"
    : `${attendeeCount || cartCount} ${attendeeCount === 1 ? "attendee" : "attendees"}${coinsToReceive ? ` · ${formatCoins(coinsToReceive)}` : ""}`;
  const phaseSummary = activePhase
    ? `${activePhase.name} live until ${formatPhaseEnd(activePhase.ends_at)}`
    : "Live pricing updates from admin controls";
  const crewTenOption = groupedOptions.group.find((option) => option.id === "ten-pax-four-intensives-party" || option.pax === 10);
  const crewSixOption = groupedOptions.group.find((option) => option.id === "six-pax-four-intensives-party" || option.pax === 6);
  const primaryGroupOption = crewTenOption || selectedGroupOption;
  const secondaryGroupOption = crewSixOption || groupedOptions.group.find((option) => option.id !== primaryGroupOption?.id);
  const crewCtaLabel = primaryGroupOption?.pax
    ? `Bring your crew · from ${formatEventPrice(Math.round(primaryGroupOption.priceInr / primaryGroupOption.pax))} per head`
    : "Bring your crew";
  const fourIntensivesOption = groupedOptions.intensives.find((option) => option.id === "four-intensives") || fourIntensiveOption;
  const oneOrTwoIntensiveOptions = groupedOptions.intensives.filter((option) => option.id !== fourIntensivesOption?.id);
  const individualPassOptions = [
    fourIntensivesOption,
    fullPassOption,
    partyOption,
    ...oneOrTwoIntensiveOptions,
  ].filter((option, index, options): option is EventPackageOption =>
    Boolean(option) && options.findIndex((candidate) => candidate?.id === option.id) === index,
  );

  return (
    <main className="pinkd-handoff-page">
      <nav className="nav">
        <div className="wrap">
          <a href="#top" className="nav-logo" aria-label="Pink'D home">
            <img src={hashtagLogoImage} alt="Hashtag For Dance" />
          </a>
          <div className="nav-links">
            <a href="#schedule">Schedule</a>
            <a href="#faculty">Faculty</a>
            <a href="#cause">The Cause</a>
            <a href="#passes">Passes</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="nav-actions">
            <Link to="/dashboard" className="dash-link">Dashboard</Link>
            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className={`nav-cart ${cartCount > 0 ? "has" : ""}`}
            >
              <ShoppingBag className="h-4 w-4" />
              Cart
              <span className="count">{cartCount}</span>
            </button>
          </div>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="hero-media">
          <video src={heroVideo} poster={heroPoster} autoPlay muted loop playsInline aria-hidden="true" />
        </div>
        <div className="hero-glow a" />
        <div className="hero-glow b" />
        <div className="hero-grain" />
        <div className="wrap">
          <div>
            <span className="kicker kicker-hero">A <em>FUN'draiser</em> by Hashtag For Dance · 7 years of Pink'D</span>
            <img className="hero-logo" src={logoImage} alt="PINK'D" />
            <h1>Two nights of <em>intensives.</em><br />One night that <em>doesn't end.</em></h1>
            <div className="meta">
              <span><i />9 - 11 September 2026</span>
              <span><i />Rajouri Garden & Gurugram</span>
              <span><i />4 intensives · 1 all-night party</span>
              <span><i />Party is 18+</span>
            </div>
            {activePhase ? <div className="phase-pill">{phaseSummary}</div> : null}
            <div className="hero-cta">
              <a className="btn btn-pink" href="#passes">Book your pass</a>
              <a className="btn btn-ghost" href="#crew">{crewCtaLabel}</a>
            </div>
            <div className="cause-pill-wrap">
              <span className="cause-pill">
                <Sparkles className="h-4 w-4" />
                <span>Every rupee after costs goes to <b>dance scholarships</b></span>
              </span>
            </div>
          </div>

          <aside className="hero-side">
            {primaryGroupOption ? (
              <div className="hero-card crew">
                <span className="kicker">Crew of {primaryGroupOption.pax || 10} · Best value</span>
                <div className="big">
                  {formatEventPrice(primaryGroupOption.priceInr)}
                  {primaryGroupOption.pax ? <small>{formatEventPrice(Math.round(primaryGroupOption.priceInr / primaryGroupOption.pax))} per head</small> : null}
                </div>
                <p>{primaryGroupOption.description}</p>
                {renderUrgencyMeter(primaryGroupOption.id)}
                <div className="row">
                  <span className="save">Seats held together</span>
                  <button type="button" className="btn btn-pink btn-sm" onClick={() => openPackageModal(primaryGroupOption)}>
                    Book crew
                  </button>
                </div>
              </div>
            ) : null}
            {partyOption ? (
              <div className="hero-card">
                <span className="kicker">Party · {activePhase ? `${activePhase.name} live` : "Live pricing"}</span>
                <div className="big">
                  {formatEventPrice(partyOption.priceInr)}
                  <small>{activePhase ? activePhase.name : "admin price"}</small>
                </div>
                <p>Welcome drink, wristband, and games powered by Pink'D Coins.</p>
                {renderUrgencyMeter(partyOption.id)}
                <div className="row">
                  <span className="live-line"><i className="live-dot" />Live capacity</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openPackageModal(partyOption)}>
                    Add party
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </header>

      <div className="stats">
        <div className="wrap">
          {[
            ["7 years", "of Pink'D · Hashtag's anniversary"],
            ["600+", "Dancers expected across 3 days"],
            ["120 seats", "Hard cap per intensive"],
            ["4 faculty teams", "10 instructors, 4 sessions"],
          ].map(([value, label]) => (
            <div className="stat" key={value}>
              <b>{value.includes("+") ? <span>{value}</span> : value}</b>
              <small>{label}</small>
            </div>
          ))}
        </div>
      </div>

      <section id="schedule">
        <div className="wrap">
          <div className="sec-head">
            <span className="kicker">The three days · 7th anniversary edition</span>
            <h2>Two days to elevate. One night to celebrate.</h2>
            <p className="lead">
              Two evenings of intensives at {intensiveVenueLabel}, then the floor heads to {partyVenueLabel}.
            </p>
          </div>
          <div className="days">
            {[
              {
                date: "09",
                day: "Wednesday",
                title: "September",
                images: ["/media/faculty-01.jpg", "/media/faculty-02.jpg"],
                slots: [
                  ["6:00 - 7:30 PM", "Intensive 1", "Shivek & Priyanshi"],
                  ["8:00 - 9:30 PM", "Intensive 2", "Tarun, Dhriti & Divija"],
                ],
                venue: `${intensiveVenueLabel} · Styles announced closer to the date`,
                venueUrl: intensiveDirectionsUrl,
              },
              {
                date: "10",
                day: "Thursday",
                title: "September",
                images: ["/media/faculty-03.jpg", "/media/faculty-04.jpg"],
                slots: [
                  ["6:00 - 7:30 PM", "Intensive 3", "Jahnvi & Rubani"],
                  ["8:00 - 9:30 PM", "Intensive 4", "Manas, Jhilmil & Ayushi"],
                ],
                venue: `${intensiveVenueLabel} · 120 seats per session`,
                venueUrl: intensiveDirectionsUrl,
              },
              {
                date: "11",
                day: "Friday",
                title: "The Pink'D party",
                slots: [["9 PM - Late", "All-night party at Glass Villa", "DJ · Karaoke · Pool · Welcome drink + games"]],
                venue: `${partyVenueLabel} · Entry includes wristband`,
                venueUrl: partyDirectionsUrl,
                party: true,
              },
            ].map((day) => (
              <article
                className={`day ${day.party ? "party" : ""}`}
                key={day.date}
                style={day.party ? { backgroundImage: `linear-gradient(180deg,rgba(42,18,38,.55),rgba(27,20,32,.96) 70%),url(${partyCardImage})` } : undefined}
              >
                {!day.party ? (
                  <div className="day-bg">
                    {day.images?.map((image) => <img src={image} alt="" key={image} />)}
                  </div>
                ) : null}
                <div className="day-date">
                  <b>{day.date}</b>
                  <div>{day.day}<em>{day.title}</em></div>
                </div>
                <div className="slots">
                  {day.slots.map(([time, title, faculty]) => (
                    <div className="slot" key={`${day.date}-${time}`}>
                      <time>{time}</time>
                      <div>
                        <b>{title}</b>
                        <small>{faculty}</small>
                      </div>
                    </div>
                  ))}
                </div>
                {day.party ? (
                  <div className="tags">
                    {["DJ set", "Karaoke", "4 free games", "Pink'D Coins", "18+ · ID at gate"].map((tag) => (
                      <span className="tag" key={tag}>{tag}</span>
                    ))}
                  </div>
                ) : null}
                <div className="venue">
                  <MapPin className="h-4 w-4" />
                  <a href={day.venueUrl} target="_blank" rel="noreferrer">{day.venue}</a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="faculty" id="faculty">
        <div className="wrap">
          <div className="sec-head">
            <span className="kicker">Faculty</span>
            <h2>Four rooms. Ten teachers.</h2>
            <p className="lead">
              Every session is co-led by Hashtag company members. Your selected slots are stored with the booking.
            </p>
          </div>
          <div className="fac-grid">
            {facultyCards.map(({ time, names, label, image }) => (
              <a className="fac" href="#passes" key={label}>
                <img src={image} alt={names} />
                <div className="info">
                  <span className="kicker">{time}</span>
                  <b>{names}</b>
                  <small>{label}</small>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section className="cause" id="cause">
        <div className="wrap">
          <div>
            <span className="kicker">#DanceForACause</span>
            <blockquote>Dancers shouldn't perform for free. <em>Pink'D exists so the next ones don't have to.</em></blockquote>
            <p className="lead">
              Seven years of Pink'D have helped fund scholarships at Hashtag. Your pass is the fee. The party is the thank-you.
            </p>
            <div className="facts">
              {[
                ["10%", "of every ticket goes straight into the scholarship fund"],
                ["5 forms", "each scholarship student trains across five dance forms"],
                ["~₹50K", "is what one month of full training for one student costs"],
              ].map(([value, label]) => (
                <div className="fact" key={value}>
                  <b>{value}</b>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="years">
            {legacyImages.map(([image, label]) => (
              <div className="year" key={image}>
                <img src={image} alt={label} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="gallery" id="gallery">
        <div className="wrap sec-head">
          <span className="kicker">Last edition · September 2025</span>
          <h2>This is what your pass looks like at midnight.</h2>
        </div>
        <div className="marquee" aria-hidden="true">
          <div className="track">
            {[...galleryImages, ...galleryImages].map((image, index) => (
              <img src={image} alt="" key={`${image}-${index}`} loading="lazy" />
            ))}
          </div>
        </div>
      </section>

      <section className="pricing" id="passes">
        <div className="wrap">
          <div className="sec-head">
            <span className="kicker">Passes</span>
            <h2>Come alone. Or come as a crew and pay less.</h2>
            <p className="lead">
              Prices, phases, and availability stay live from the admin dashboard, so this page and checkout never disagree.
            </p>
          </div>

          {packagesLoading ? <div className="loading-card">Loading available packages...</div> : null}

          <div className="crew-grid" id="crew">
            {primaryGroupOption ? (
              <article className="crewcard">
                <span className="ribbon">Best value · Crew of {primaryGroupOption.pax || 10}</span>
                <div className="crew-in">
                  <div>
                    <h3>{primaryGroupOption.name}</h3>
                    <div className="sub">{primaryGroupOption.description}</div>
                  </div>
                  <div className="price-row">
                    <div className="price">{formatEventPrice(primaryGroupOption.priceInr)}</div>
                    {primaryGroupOption.pax ? (
                      <div className="perhead">
                        <b>{formatEventPrice(Math.round(primaryGroupOption.priceInr / primaryGroupOption.pax))} per head</b>
                        <small>vs solo full pass</small>
                      </div>
                    ) : null}
                  </div>
                  <span className="save">Seats held together across all four sessions</span>
                  <ul className="incl">
                    <li><CheckCircle2 />All four intensives for the full crew</li>
                    <li><CheckCircle2 />Party entry, wristbands, and welcome drinks</li>
                    <li><CheckCircle2 />Price saved to the order by the backend at checkout</li>
                  </ul>
                  {renderUrgencyMeter(primaryGroupOption.id)}
                  <div className="crew-actions">
                    <button type="button" className="btn btn-pink" onClick={() => openPackageModal(primaryGroupOption)}>
                      Book crew · {formatEventPrice(primaryGroupOption.priceInr)}
                    </button>
                  </div>
                </div>
              </article>
            ) : null}

            {secondaryGroupOption ? (
              <article className="crewcard secondary">
                <span className="ribbon gold">Crew of {secondaryGroupOption.pax || 6}</span>
                <div className="crew-in">
                  <div>
                    <h3>{secondaryGroupOption.name}</h3>
                    <div className="sub">{secondaryGroupOption.description}</div>
                  </div>
                  <div className="price-row">
                    <div className="price">{formatEventPrice(secondaryGroupOption.priceInr)}</div>
                    {secondaryGroupOption.pax ? (
                      <div className="perhead">
                        <b>{formatEventPrice(Math.round(secondaryGroupOption.priceInr / secondaryGroupOption.pax))} per head</b>
                        <small>flat group price</small>
                      </div>
                    ) : null}
                  </div>
                  <ul className="incl">
                    <li><CheckCircle2 />All four intensives for the full crew</li>
                    <li><CheckCircle2 />Party entry and wristbands included</li>
                    <li><CheckCircle2 />Phase-proof checkout total</li>
                  </ul>
                  {renderUrgencyMeter(secondaryGroupOption.id)}
                  <div className="crew-actions">
                    <button type="button" className="btn btn-pink" onClick={() => openPackageModal(secondaryGroupOption)}>
                      Book crew · {formatEventPrice(secondaryGroupOption.priceInr)}
                    </button>
                  </div>
                </div>
              </article>
            ) : null}
          </div>

          <p className="custom">
            Event revenue is INR only. Pink'D Coins can be added in cart for games at the party.
          </p>

          <div className="divider">Individual passes</div>
          <div className="solo-grid">
            {individualPassOptions.map((option) => (
              <article className={`solo ${option.featured ? "rec" : ""}`} key={option.id}>
                {option.featured ? <span className="ribbon">Most popular</span> : null}
                <div>
                  <h3>{option.name}</h3>
                  <div className="sub">{option.description}</div>
                </div>
                <div className="price">{formatEventPrice(option.priceInr)}</div>
                <ul className="incl">
                  {option.category === "party" || option.category === "package" ? <li><CheckCircle2 />Party entry and wristband included</li> : null}
                  <li><CheckCircle2 />Stored as a full cart order in Supabase</li>
                </ul>
                {option.category === "party" ? (
                  <div className="phase">
                    <div className="row">
                      <span>{activePhase ? activePhase.name : "Live phase"}</span>
                      <b>{formatEventPrice(option.priceInr)}</b>
                    </div>
                    {renderUrgencyMeter(option.id)}
                  </div>
                ) : renderUrgencyMeter(option.id)}
                <button type="button" className={`btn ${option.featured ? "btn-pink" : "btn-ghost"}`} onClick={() => openPackageModal(option)}>
                  Add to cart
                </button>
              </article>
            ))}
          </div>

          <div className="trust">
            <span><ShieldCheck />Secure payment via {getGatewayLabel(paymentProvider)}</span>
            <span><Mail />Confirmation email after payment</span>
            <span><Coins />Pink'D Coins available in cart</span>
            <span><CreditCard />Event orders are INR only</span>
          </div>
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
                      <div className="text-sm text-white/56">
                        {activePhase ? `${activePhase.name} price` : "Package price"}
                      </div>
                      <div className="mt-1 text-3xl font-black text-primary">{formatEventPrice(selectedPackage.priceInr)}</div>
                    </div>
                    {selectedPackage.pax ? <Badge className="bg-white/10 text-white hover:bg-white/15">{selectedPackage.pax} pax</Badge> : null}
                  </div>
                  {renderUrgencyMeter(selectedPackage.id)}
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
                <div>{eventDateLabel}</div>
                {confirmedOrder.includesIntensives ? (
                  <a
                    href={intensiveDirectionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
                  >
                    Intensives at {intensiveVenueLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                {confirmedOrder.includesParty ? (
                  <a
                    href={partyDirectionsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold underline underline-offset-4"
                  >
                    Party at {partyVenueLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                ) : null}
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

      <section className="faq" id="faq">
        <div className="wrap">
          <div>
            <span className="kicker">Before you book</span>
            <h2>Questions crews ask us.</h2>
            <p className="lead">
              Anything else, reach the team through the policy/contact page. Payment status updates after gateway verification.
            </p>
            <button type="button" className="btn btn-ghost" onClick={() => setIsCartOpen(true)}>
              Review cart
            </button>
          </div>
          <div className="acc">
          {[
            [
              "How does a group booking work?",
              "One person pays for the crew in a single checkout. The order stores the package, quantity, selected time slots, customer details, and payment status for admin reporting.",
            ],
            [
              "What's included in party entry?",
              "Entry to Glass Villa on Friday 11 September, your Pink'D wristband, and a welcome drink. Pink'D Coins can be bought in the same cart for games at the party.",
            ],
            [
              "Why can prices change?",
              "Admins control Early Bird, Phase 1, and Last Call prices from the dashboard. The active phase price is frozen on the order when checkout is created.",
            ],
            [
              "Do I pick my intensive sessions?",
              "Yes for 1- and 2-intensive passes. Full intensive, full pass, and group packages automatically include all four slots.",
            ],
            [
              "Is there an age limit?",
              "The intensives are open to all. The party is 18+ with valid ID checked at the gate.",
            ],
            [
              "Can I get a refund or transfer my ticket?",
              "All bookings are non-refundable and non-transferable. Please double-check dates, package, and attendee plan before payment.",
            ],
          ].map(([question, answer], index) => (
            <details key={question} open={index === 0}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
          </div>
        </div>
      </section>

      <section className="final">
        <div className="wrap">
          <div className="box">
            <span className="kicker">9 - 11 September · Rajouri Garden & Gurugram</span>
            <h2>Round up your people.</h2>
            <p className="lead">
              Four intensives, one all-night party, and a dancer somewhere gets to train because you showed up.
            </p>
            <div className="hero-cta">
            {primaryGroupOption ? (
              <button type="button" className="btn btn-pink" onClick={() => openPackageModal(primaryGroupOption)}>
                Book crew · {formatEventPrice(primaryGroupOption.priceInr)}
              </button>
            ) : null}
              <a className="btn btn-ghost" href="#passes">See all passes</a>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <span>Pink'D · A <b>FUN'draiser</b> by Hashtag For Dance · 7 years of Pink'D · 2026</span>
          <nav aria-label="Policy links">
            <Link to="/contact-us">Contact Us</Link>
            <Link to="/terms-and-conditions">Terms & Conditions</Link>
            <Link to="/refunds-cancellations">Refunds & Cancellations</Link>
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

          document.getElementById("passes")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        className={`sticky-cta ${showBottomSticker ? "show" : ""}`}
      >
        <span className="pulse" />
        <span className="t">
          <b>{cartBannerTitle}</b>
          <small>{cartBannerSub}</small>
        </span>
        <span className="total">{formatEventPrice(grandTotal)}</span>
        <span className="btn btn-pink btn-sm">Checkout</span>
      </button>
    </main>
  );
}
