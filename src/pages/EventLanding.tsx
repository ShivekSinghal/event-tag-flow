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
  Trash2,
  User,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import {
  createCheckoutToken,
  getGatewayLabel,
  getPaymentErrorMessage,
  runGatewayPayment,
  sha256Hex,
  waitForSheetCloseAnimation,
  type PaymentProvider,
} from "@/lib/checkoutGateway";
import { getSessionAvailability, usePartyStatus, type PartyPhaseStatus, type SessionAvailability } from "@/lib/partyStatus";
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
  isPackageRevealed,
  normalizeEventPackage,
} from "@/lib/eventPackages";
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
const heroVideo = "/media/hero-reel.mp4";
const heroPoster = "/media/hero-poster.jpg";
const partyCardImage = "/media/party-card.jpg";
const eventDateLabel = "11 SEPTEMBER";
const intensiveVenueLabel = "#HASHTAG RAJOURI GARDEN";
const intensiveDirectionsUrl = "https://share.google/YFUUQ85X3WYy0wVLE";
const partyVenueLabel = "GLASS VILLA, GURGAON";
const partyDirectionsUrl = "https://www.google.com/maps/search/?api=1&query=Glass%20Villa%20Gurgaon";

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
  ["/media/legacy-2025.jpg", "Pink'd 2025"],
  ["/media/legacy-2024.jpg", "Pink'd 2024"],
  ["/media/legacy-2023.jpg", "Pink'd 2023"],
  ["/media/legacy-2022.jpg", "Pink'd 2022"],
  ["/media/legacy-2021.jpg", "Pink'd 2021"],
];

const galleryImages = Array.from({ length: 12 }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return `/media/gallery-${number}.jpg`;
});


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
  if (selectedTimeSlots.length === 0) return intensiveCount === 1 ? "Pick your session" : `Pick ${intensiveCount} sessions`;
  if (selectedTimeSlots.length === EVENT_TIME_SLOTS.length) return "All 4 sessions";
  return `${selectedTimeSlots.length} of ${intensiveCount} selected`;
}

function getSeatNote(session: SessionAvailability | undefined) {
  if (!session) return null;
  if (session.soldOut) return "Sold out";
  if (session.warning) return `Only ${session.remaining} seat${session.remaining === 1 ? "" : "s"} left`;
  return null;
}

function shortSlotLabel(slot: string) {
  const day = slot.startsWith("Wednesday") ? "Wed" : slot.startsWith("Thursday") ? "Thu" : slot.split(",")[0];
  const time = slot.split("@")[1]?.trim() || "";
  return `${day} · ${time}`;
}

function getPartyMeter(phase: PartyPhaseStatus | null) {
  if (!phase) return null;
  const phaseSize = phase.next_min_party_count !== null ? phase.next_min_party_count - phase.min_party_count : null;
  const remaining = phase.remaining_in_phase;
  const remainingLine = remaining !== null && phaseSize
    ? `${remaining} of ${phaseSize} ${phase.name} spots left`
    : `${phase.name} · final price`;
  const soldOutLine = phase.number > 1 ? `Phase ${phase.number - 1} sold out — now ${formatEventPrice(phase.price_inr)}` : null;
  const nextLine = phase.next_price_inr !== null ? `Then ${formatEventPrice(phase.next_price_inr)}` : null;
  const stickyLine = remaining !== null && phaseSize
    ? `${phase.name} · ${remaining} party spot${remaining === 1 ? "" : "s"} left at ${formatEventPrice(phase.price_inr)}`
    : `${phase.name} · party entry ${formatEventPrice(phase.price_inr)}`;
  return { remainingLine, soldOutLine, nextLine, stickyLine };
}

function getOrderErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }
  return "Could not reserve this cart. Please try again.";
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
    needsAttendeeForm?: boolean;
  } | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<EventPackageOption | null>(null);
  const [pendingSlots, setPendingSlots] = useState<string[]>([]);
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showBottomSticker, setShowBottomSticker] = useState(false);
  const heroVideoRef = useRef<HTMLVideoElement | null>(null);

  // Mobile autoplay: React sets `muted` as a property, not an attribute, and iOS Safari / Android
  // Chrome only autoplay a video whose muted *attribute* is present at load. Set it by hand, start
  // playback ourselves, and retry on the first touch for phones in Low Power / Data Saver mode.
  useEffect(() => {
    const video = heroVideoRef.current;
    if (!video) return;
    video.defaultMuted = true;
    video.muted = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    const tryPlay = () => {
      const attempt = video.play();
      if (attempt && typeof attempt.catch === "function") attempt.catch(() => {});
    };
    const onFirstTouch = () => tryPlay();
    const onVisible = () => {
      if (!document.hidden) tryPlay();
    };
    tryPlay();
    window.addEventListener("touchstart", onFirstTouch, { once: true, passive: true });
    window.addEventListener("pointerdown", onFirstTouch, { once: true, passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("touchstart", onFirstTouch);
      window.removeEventListener("pointerdown", onFirstTouch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const [eventOptions, setEventOptions] = useState<EventPackageOption[]>(EVENT_PACKAGE_OPTIONS);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const { status: partyStatus, isLive: partyStatusLive, refresh: refreshPartyStatus } = usePartyStatus();
  const [revealClock, setRevealClock] = useState(() => Date.now());
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>("cashfree");
  const [paymentSettingsLoading, setPaymentSettingsLoading] = useState(true);
  const [isGatewayActive, setIsGatewayActive] = useState(false);
  const [isGatewayOpening, setIsGatewayOpening] = useState(false);
  const [selectedGroupPackageId, setSelectedGroupPackageId] = useState("");
  const viewContentTrackedRef = useRef(false);

  const fetchEventConfig = useCallback(async () => {
    try {
      setPackagesLoading(true);
      setPaymentSettingsLoading(true);

      const [packageResult, paymentSettingResult] = await Promise.all([
        supabase
          .from("event_packages")
          .select("*")
          .eq("active", true)
          .order("display_order", { ascending: true }),
        supabase
          .from("payment_gateway_settings")
          .select("active_provider")
          .eq("id", "event_bookings")
          .single(),
      ]);

      if (packageResult.error) throw packageResult.error;
      if (paymentSettingResult.error) throw paymentSettingResult.error;

      setEventOptions((packageResult.data || []).length > 0 ? packageResult.data.map(normalizeEventPackage) : EVENT_PACKAGE_OPTIONS);
      setPaymentProvider(paymentSettingResult.data?.active_provider === "razorpay" ? "razorpay" : "cashfree");
    } catch (error) {
      console.error("Event config load failed:", error);
      setEventOptions(EVENT_PACKAGE_OPTIONS);
      setPaymentProvider("cashfree");
    } finally {
      setPackagesLoading(false);
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

  // Timed reveals: a pass with available_from in the future stays hidden, then
  // appears at that exact moment without a reload (the server refuses it earlier anyway).
  useEffect(() => {
    const pending = eventOptions
      .map((option) => (option.availableFrom ? new Date(option.availableFrom).getTime() : Number.NaN))
      .filter((revealAt) => Number.isFinite(revealAt) && revealAt > Date.now());
    if (pending.length === 0) return;
    const delay = Math.min(Math.max(Math.min(...pending) - Date.now(), 0) + 250, 2_147_000_000);
    const timer = window.setTimeout(() => setRevealClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [eventOptions, revealClock]);

  const revealedEventOptions = useMemo(
    () => eventOptions.filter((option) => isPackageRevealed(option, revealClock)),
    [eventOptions, revealClock],
  );

  // Live phase + seat availability. The server prices the party entry at the
  // moment Pay is clicked; everything shown here is display only.
  const partyPhase = partyStatus?.phase ?? null;
  const partyMeter = useMemo(() => getPartyMeter(partyPhase), [partyPhase]);
  const sessionAvailability = useMemo(() => getSessionAvailability(partyStatus), [partyStatus]);
  const soldOutSlots = useMemo(
    () => new Set(sessionAvailability.filter((session) => session.soldOut).map((session) => session.label)),
    [sessionAvailability],
  );
  const anySessionSoldOut = soldOutSlots.size > 0;
  const allSessionsSoldOut = soldOutSlots.size >= EVENT_TIME_SLOTS.length;
  const isOptionSoldOut = useCallback(
    (option: EventPackageOption | null | undefined) => {
      if (!option) return false;
      const intensives = option.intensiveCount || 0;
      if (intensives >= EVENT_TIME_SLOTS.length) return anySessionSoldOut;
      if (intensives > 0) return allSessionsSoldOut || EVENT_TIME_SLOTS.length - soldOutSlots.size < intensives;
      return false;
    },
    [allSessionsSoldOut, anySessionSoldOut, soldOutSlots],
  );
  const displayEventOptions = useMemo(
    () =>
      revealedEventOptions.map((option) =>
        option.category === "party" && partyPhase ? { ...option, priceInr: partyPhase.price_inr } : option,
      ),
    [revealedEventOptions, partyPhase],
  );
  const smallIntensivePassesLive = displayEventOptions.some(
    (option) => (option.intensiveCount || 0) > 0 && (option.intensiveCount || 0) < EVENT_TIME_SLOTS.length,
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

  const eventSubtotal = cartLines.reduce((sum, line) => sum + line.lineTotal, 0);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const grandTotal = eventSubtotal;
  const hasCheckoutItems = cartLines.length > 0;
  const purchasedItemsSummary = useMemo(
    () => cartLines.map((line) => `${line.quantity} x ${line.option.name}`).join(", "),
    [cartLines],
  );
  const trackingItems = useMemo<TrackingCartItem[]>(
    () =>
      cartLines.map((line) => ({
        item_id: line.packageId,
        item_name: line.option.name,
        item_category: line.option.category,
        price: line.option.priceInr,
        quantity: line.quantity,
      })),
    [cartLines],
  );

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

    if (soldOutSlots.has(slot)) {
      toast({
        title: "Session Sold Out",
        description: `${shortSlotLabel(slot)} has hit its 120-seat cap. Pick another session.`,
        variant: "destructive",
      });
      return;
    }

    const selected = pendingSlots.includes(slot);
    if (selected) {
      setPendingSlots((current) => current.filter((timeSlot) => timeSlot !== slot));
      return;
    }

    if (selectedPackage.intensiveCount === 1) {
      setPendingSlots([slot]);
      return;
    }

    if (pendingSlots.length >= selectedPackage.intensiveCount) {
      toast({
        title: "That's Your Limit",
        description: `This pass covers ${selectedPackage.intensiveCount} sessions. Deselect one first, or book 4 Intensives to attend everything.`,
        variant: "destructive",
      });
      return;
    }

    setPendingSlots((current) => [...current, slot]);
  };

  const confirmAddToCart = () => {
    if (!selectedPackage) return;

    if (isOptionSoldOut(selectedPackage)) {
      toast({
        title: "Sold Out",
        description: "One of the sessions this pass includes is full, so it can't be booked any more.",
        variant: "destructive",
      });
      return;
    }

    const allowedSlots = selectedPackage.intensiveCount || 0;
    const selectedTimeSlots = allowedSlots >= EVENT_TIME_SLOTS.length ? EVENT_TIME_SLOTS : pendingSlots;

    if (allowedSlots > 0 && allowedSlots < EVENT_TIME_SLOTS.length && selectedTimeSlots.length !== allowedSlots) {
      toast({
        title: allowedSlots === 1 ? "Pick Your Session" : `Pick ${allowedSlots} Sessions`,
        description: allowedSlots === 1
          ? "Choose the one session you want to attend."
          : `This pass needs exactly ${allowedSlots} sessions — you have ${selectedTimeSlots.length} selected.`,
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
        description: "Add at least one pass before checkout.",
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
    const orderPartyEntries = cartLines.reduce(
      (sum, line) => (packageIncludesParty(line.option) ? sum + Math.max(line.option.pax || 1, 1) * line.quantity : sum),
      0,
    );
    const orderNeedsAttendeeForm = orderPartyEntries > 1;
    const pricingPhase = partyPhase?.key || partyPhase?.name;

    try {
      const checkoutToken = createCheckoutToken();
      const checkoutTokenHash = await sha256Hex(checkoutToken);
      // The server decides every price (party phase, seat caps); the cart only sends keys and quantities.
      const { data, error } = await supabase
        .rpc("create_event_order_checkout", {
          p_customer_name: form.name.trim(),
          p_customer_phone: form.phone.trim(),
          p_customer_email: form.email.trim(),
          p_customer_studio: form.studio,
          p_checkout_token_hash: checkoutTokenHash,
          p_attribution: getLandingAttribution() as unknown as Json,
          p_cart_items: cartLines.map((line) => ({
            item_type: "event_package",
            package_key: line.packageId,
            quantity: line.quantity,
            selected_time_slots: line.selectedTimeSlots,
          })),
        })
        .single();

      if (error) throw error;

      const orderId = data.order_id;
      const orderTotal = Number(data.total_amount_inr);
      let paymentFlowCompleted = false;
      let attemptedPaymentProvider: PaymentProvider = paymentProvider;

      trackInitiateCheckout({
        orderId,
        value: orderTotal,
        items: trackingItems,
        paymentProvider: attemptedPaymentProvider,
        pricingPhase,
      });

      try {
        const result = await runGatewayPayment({
          orderId,
          checkoutToken,
          fallbackCustomer: {
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
          },
          description: "Pink'd event booking",
          onProviderKnown: (provider) => {
            attemptedPaymentProvider = provider;
          },
          onGatewayVisible: () => setIsGatewayOpening(false),
        });

        setConfirmedOrder({
          id: orderId,
          total: orderTotal,
          status: result.isPaid ? "paid" : "pending",
          customerEmail: form.email.trim(),
          purchasedItems: purchasedItemsSummary,
          includesIntensives: orderIncludesIntensives,
          includesParty: orderIncludesParty,
          confirmationEmailSent: result.confirmationEmailSent,
          confirmationEmailError: result.confirmationEmailError,
          needsAttendeeForm: orderNeedsAttendeeForm,
        });

        if (result.isPaid) {
          trackPurchaseOnce({
            orderId,
            value: orderTotal,
            items: trackingItems,
            paymentProvider: result.provider,
            pricingPhase,
          });
          trackLeadOnce({
            orderId,
            value: orderTotal,
            items: trackingItems,
            paymentProvider: result.provider,
            pricingPhase,
          });
        }

        toast({
          title: result.isPaid ? "Payment Confirmed" : "Payment Pending",
          description: result.isPaid
            ? result.confirmationEmailSent
              ? `Your Pink'd booking is confirmed. Confirmation email sent to ${form.email.trim()}.`
              : `Your Pink'd booking is confirmed.${result.confirmationEmailError ? ` Email could not be sent: ${result.confirmationEmailError}` : ""}`
            : `Your order is saved, but ${getGatewayLabel(result.provider)} has not confirmed payment yet.`,
        });
        paymentFlowCompleted = true;
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
          needsAttendeeForm: orderNeedsAttendeeForm,
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
        setForm(initialFormState);
      }
      refreshPartyStatus();
    } catch (error) {
      console.error("Event order creation failed:", error);
      refreshPartyStatus();
      setIsCartOpen(true);
      toast({
        title: "Order Failed",
        description: getOrderErrorMessage(error),
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
  const totalCartItems = cartLines.length;
  const firstCartLine = cartLines[0] || null;
  const cartBannerTitle = totalCartItems === 0
    ? "Pick a pass"
    : totalCartItems === 1 && firstCartLine
      ? firstCartLine.option.name
      : `${totalCartItems} items selected`;
  const cartBannerSub = totalCartItems === 0
    ? "All passes are billed in INR"
    : `${attendeeCount || cartCount} ${attendeeCount === 1 ? "attendee" : "attendees"}`;
  const crewTenOption = groupedOptions.group.find((option) => option.id === "ten-pax-four-intensives-party" || option.pax === 10);
  const crewSixOption = groupedOptions.group.find((option) => option.id === "six-pax-four-intensives-party" || option.pax === 6);
  const primaryGroupOption = crewTenOption || selectedGroupOption;
  const secondaryGroupOption = crewSixOption || groupedOptions.group.find((option) => option.id !== primaryGroupOption?.id);
  const crewCtaLabel = primaryGroupOption?.pax
    ? `Bring your crew · from ${formatEventPrice(Math.round(primaryGroupOption.priceInr / primaryGroupOption.pax))} per head`
    : "Bring your crew";
  const fourIntensivesOption = groupedOptions.intensives.find((option) => option.id === "four-intensives") || fourIntensiveOption;
  const oneOrTwoIntensiveOptions = groupedOptions.intensives
    .filter((option) => option.id !== fourIntensivesOption?.id)
    .sort((a, b) => (a.intensiveCount || 0) - (b.intensiveCount || 0));
  // Order matters: 1 → 2 → 4 intensives, then the full pass, then party entry.
  const individualPassOptions = [
    ...oneOrTwoIntensiveOptions,
    fourIntensivesOption,
    fullPassOption,
    partyOption,
  ].filter((option, index, options): option is EventPackageOption =>
    Boolean(option) && options.findIndex((candidate) => candidate?.id === option.id) === index,
  );
  const primaryGroupSavings = primaryGroupOption
    ? Math.max(0, ((fullPassOption?.priceInr || 5500) * (primaryGroupOption.pax || 10)) - primaryGroupOption.priceInr)
    : 0;
  const secondaryGroupSavings = secondaryGroupOption
    ? Math.max(0, ((fullPassOption?.priceInr || 5500) * (secondaryGroupOption.pax || 6)) - secondaryGroupOption.priceInr)
    : 0;
  const stickySubText = hasCheckoutItems
    ? cartBannerSub
    : partyMeter
      ? partyMeter.stickyLine
      : primaryGroupOption?.pax
        ? `Crews from ${formatEventPrice(Math.round(primaryGroupOption.priceInr / primaryGroupOption.pax))} per head`
        : "Crews from ₹4,800 per head";
  const crewSoldOut = isOptionSoldOut(primaryGroupOption);
  const renderSessionNotes = () => {
    const notes = sessionAvailability.map((session) => ({ session, note: getSeatNote(session) })).filter((entry) => entry.note);
    if (notes.length === 0) return null;
    return (
      <div className="seat-notes">
        {notes.map(({ session, note }) => (
          <span className={`seat-note ${session.soldOut ? "soldout" : ""}`} key={session.key}>
            {shortSlotLabel(session.label)} · {note}
          </span>
        ))}
      </div>
    );
  };

  const renderIndividualPassDetails = (option: EventPackageOption) => {
    const soldOut = isOptionSoldOut(option);

    if (option.id === "one-intensive" || option.intensiveCount === 1) {
      return (
        <>
          <div>
            <h3>1 Intensive</h3>
            <div className="sub">Pick any one session</div>
          </div>
          <div className="price">{formatEventPrice(option.priceInr)}</div>
          <ul className="incl">
            <li><CheckCircle2 />One 90-minute session, Rajouri Garden</li>
            <li><CheckCircle2 />You choose the day and time — styles drop closer to the date</li>
            <li className="dim">No party entry</li>
          </ul>
          {renderSessionNotes()}
        </>
      );
    }

    if (option.id === "two-intensives" || option.intensiveCount === 2) {
      return (
        <>
          <div>
            <h3>2 Intensives</h3>
            <div className="sub">Pick any two sessions</div>
          </div>
          <div className="price">{formatEventPrice(option.priceInr)}</div>
          <ul className="incl">
            <li><CheckCircle2 />Two sessions, either evening or one each</li>
            <li><CheckCircle2 />You choose the days and times</li>
            <li className="dim">No party entry</li>
          </ul>
          {renderSessionNotes()}
        </>
      );
    }

    if (option.id === "four-intensives") {
      return (
        <>
          <div>
            <h3>4 Intensives</h3>
            <div className="sub">Both evenings · all four sessions</div>
          </div>
          <div className="price">{formatEventPrice(option.priceInr)}</div>
          <ul className="incl">
            <li><CheckCircle2 />Intensives 1 - 4, Rajouri Garden</li>
            <li className="dim">No party entry</li>
          </ul>
          {soldOut ? <div className="seat-notes"><span className="seat-note soldout">A session is full — this pass is sold out</span></div> : renderSessionNotes()}
        </>
      );
    }

    if (option.id === "four-intensives-party") {
      return (
        <>
          <div>
            <h3>Full Pass</h3>
            <div className="sub">4 intensives + party</div>
          </div>
          <div className="price">{formatEventPrice(option.priceInr)}</div>
          <ul className="incl">
            <li><CheckCircle2 />All four intensives</li>
            <li><CheckCircle2 />Party entry · band · welcome drink · 4 free games</li>
            <li><CheckCircle2 />Flat price — saves {formatEventPrice(fullPassSavings)} vs buying separately</li>
          </ul>
          {soldOut ? <div className="seat-notes"><span className="seat-note soldout">A session is full — this pass is sold out</span></div> : null}
          <p className="u18">Party night is 18+ with valid ID at the gate. Under 18? Book 4 Intensives instead — the party portion of a full pass is forfeited, no refund.</p>
        </>
      );
    }

    if (option.id === "party-entry") {
      return (
        <>
          <div>
            <h3>Party Entry</h3>
            <div className="sub">Friday 11 Sep · Glass Villa · 18+</div>
          </div>
          <div className="price">{formatEventPrice(option.priceInr)}</div>
          <div className="phase">
            <div className="row">
              <span>{partyPhase ? partyPhase.name : "Live phase"}</span>
              <b>{formatEventPrice(option.priceInr)}</b>
            </div>
            <small>
              {partyMeter ? `${partyMeter.remainingLine}${partyMeter.nextLine ? ` · ${partyMeter.nextLine.toLowerCase()}` : ""}. ` : ""}
              Your price is held for 15 min once you hit Pay.
            </small>
          </div>
          <ul className="incl">
            <li><CheckCircle2 />Entry · wristband · welcome drink · Beer Pong · Jamaal Challenge · Red Flag Green Flag · Squid Games</li>
            <li><CheckCircle2 />Bringing friends? Add one entry each — names can be added after payment</li>
          </ul>
        </>
      );
    }

    return (
      <>
        <div>
          <h3>{option.name}</h3>
          <div className="sub">{option.description}</div>
        </div>
        <div className="price">{formatEventPrice(option.priceInr)}</div>
      </>
    );
  };

  const getPassButtonLabel = (option: EventPackageOption) => {
    if (isOptionSoldOut(option)) return "Sold out";
    if (option.id === "four-intensives") return "Reserve intensives";
    if (option.id === "four-intensives-party") return "Book full pass";
    if (option.id === "party-entry") return "Add party entry";
    if ((option.intensiveCount || 0) === 1) return "Pick your session";
    if ((option.intensiveCount || 0) === 2) return "Pick two sessions";
    return "Add to cart";
  };

  return (
    <main className="pinkd-handoff-page">
      <nav className="nav">
        <div className="wrap">
          <a href="#top" className="nav-logo" aria-label="Pink'd home">
            <img src={logoImage} alt="Pink'd" />
          </a>
          <div className="nav-links">
            <a href="#schedule">Schedule</a>
            <a href="#faculty">Faculty</a>
            <a href="#cause">The Cause</a>
            <a href="#passes">Passes</a>
            <a href="#faq">FAQ</a>
          </div>
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className={`nav-cart ${cartCount > 0 ? "has" : ""}`}
            aria-label="Open cart"
          >
            <ShoppingBag className="h-4 w-4" />
            Cart
            <span className="count">{cartCount}</span>
          </button>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="hero-media">
          <video ref={heroVideoRef} src={heroVideo} poster={heroPoster} autoPlay muted loop playsInline preload="auto" aria-hidden="true" />
        </div>
        <div className="hero-glow a" />
        <div className="hero-glow b" />
        <div className="hero-grain" />
        <div className="wrap">
          <div>
            <span className="kicker kicker-hero">A <em>FUN'draiser</em> by Hashtag For Dance · 7 years of Pink'd</span>
            <img className="hero-logo" src={logoImage} alt="Pink'd" />
            <h1>Two nights of <em>intensives.</em><br />One night that <em>doesn't end.</em></h1>
            <div className="meta">
              <span><i />9 - 11 September 2026</span>
              <span><i />Rajouri Garden & Gurugram</span>
              <span><i />4 intensives · 1 all-night party</span>
              <span><i />Party is 18+</span>
            </div>
            <div className="hero-cta">
              <a className="btn btn-pink" href="#passes">Book your pass</a>
              <a className="btn btn-ghost" href="#crew">{crewCtaLabel}</a>
            </div>
            <div className="cause-pill-wrap">
              <span className="cause-pill">
                <span aria-hidden="true">💗</span>
                <span><span className="cause-muted">Every rupee after costs</span> <b>goes to dance scholarships</b></span>
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
                <p>4 intensives + party for ten. Save versus ten full passes.</p>
                <div className="row">
                  <span className="save">Saves {formatEventPrice(primaryGroupSavings)}</span>
                  <button type="button" className="btn btn-pink btn-sm" onClick={() => openPackageModal(primaryGroupOption)} disabled={crewSoldOut}>
                    {crewSoldOut ? "Sold out" : `Book crew of ${primaryGroupOption.pax || 10}`}
                  </button>
                </div>
              </div>
            ) : null}
            {partyOption ? (
              <div className="hero-card">
                <span className="kicker">Party · {partyPhase ? `${partyPhase.name} live` : "Live pricing"}</span>
                <div className="big">
                  {formatEventPrice(partyOption.priceInr)}
                  <small>{partyPhase ? `${partyPhase.name} pricing` : "live pricing"}</small>
                </div>
                <p>
                  {partyMeter ? (
                    <>
                      <b>{partyMeter.soldOutLine || partyMeter.remainingLine}</b>
                      {partyMeter.soldOutLine ? ` · ${partyMeter.remainingLine}` : ""}
                      {partyMeter.nextLine ? ` · ${partyMeter.nextLine}` : ""}
                      {partyPhase && partyPhase.number === 1 ? " · Last call ₹2,999" : ""}
                      . Welcome drink + 4 free games included.
                    </>
                  ) : (
                    "Then ₹2,499 · Last call ₹2,999. Welcome drink + 4 free games included."
                  )}
                </p>
                <div className="row">
                  <span className="live-line"><i className={`live-dot ${partyStatusLive ? "" : "off"}`} />{partyStatusLive ? "Live" : "Last known"} · price held 15 min at checkout</span>
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
            ["7 years", "of Pink'd · Hashtag's 7th anniversary"],
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
              Two evenings of intensives at the Hashtag Rajouri Garden studio, then the whole floor heads to a farmhouse in Sector 58 for a night that runs till the sun comes up.
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
                  ["6:00 - 7:30 PM", "Intensive 1", "Shivek & Priyanshi", "1"],
                  ["8:00 - 9:30 PM", "Intensive 2", "Tarun, Dhriti & Divija", "2"],
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
                  ["6:00 - 7:30 PM", "Intensive 3", "Jahnvi & Rubani", "3"],
                  ["8:00 - 9:30 PM", "Intensive 4", "Manas, Jhilmil & Ayushi", "4"],
                ],
                venue: `${intensiveVenueLabel} · 120 seats per session`,
                venueUrl: intensiveDirectionsUrl,
              },
              {
                date: "11",
                day: "Friday",
                title: "The Pink'd party",
                slots: [["9 PM - Late", "All-night party at Glass Villa", "DJ · Karaoke · Pool · Welcome drink + 4 free games on entry"]],
                venue: "Glass Villa, Sector 58, Baliawas, Gurugram · Entry includes wristband",
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
                  {day.slots.map(([time, title, faculty, sessionKey]) => {
                    const session = sessionKey ? sessionAvailability.find((entry) => entry.key === sessionKey) : undefined;
                    const seatNote = getSeatNote(session);
                    return (
                      <div className="slot" key={`${day.date}-${time}`}>
                        <time>{time}</time>
                        <div>
                          <b>{title}</b>
                          <small>{faculty}</small>
                          {seatNote ? <small className={`seat-note ${session?.soldOut ? "soldout" : ""}`}>{seatNote}</small> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {day.party ? (
                  <div className="tags">
                    {["DJ set", "Karaoke", "4 free games", "More on Pink Coins", "Dunk drop", "18+ · ID at gate"].map((tag) => (
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
              Every session is co-led by Hashtag company members. Styles drop on Instagram before the event — a full pass gets you into all four, whatever they turn out to be.
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
            <blockquote>Dancers shouldn't perform for free. <em>Pink'd exists so the next ones don't have to.</em></blockquote>
            <p className="lead">
              Seven years of Pink'd have funded full scholarships at Hashtag — training across five forms for dancers who couldn't otherwise afford it. Your pass is the fee. The party is the thank-you.
            </p>
            <div className="facts">
              {[
                ["100%", "of proceeds after costs go straight into the scholarship fund — nothing is kept"],
                ["5 forms", "each scholarship student trains across five dance forms, six months at a time"],
                ["~₹50K", "is what one month of full training for one student costs — a crew of 10 covers almost all of it"],
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
              Bundle prices are flat — they don't move with the party phase. Group passes lock in the lowest per-head rate we offer.
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
                    <div className="sub">One booking, ten full passes. Names and numbers are managed after payment.</div>
                  </div>
                  <div className="price-row">
                    <div className="price">{formatEventPrice(primaryGroupOption.priceInr)}</div>
                    {primaryGroupOption.pax ? (
                      <div className="perhead">
                        <b>{formatEventPrice(Math.round(primaryGroupOption.priceInr / primaryGroupOption.pax))} per head</b>
                        <small>vs {formatEventPrice(fullPassOption?.priceInr || 5500)} solo</small>
                      </div>
                    ) : null}
                  </div>
                  <span className="save">Saves {formatEventPrice(primaryGroupSavings)} on ten full passes</span>
                  <ul className="incl">
                    <li><CheckCircle2 />All four intensives, both evenings, for all ten</li>
                    <li><CheckCircle2 />Party entry x10 · wristbands · welcome drinks · 4 free games each</li>
                    <li><CheckCircle2 />Price locked by the backend at checkout</li>
                    <li><CheckCircle2 />Seats held together across all four sessions</li>
                  </ul>
                  <div className="crew-actions">
                    <button type="button" className="btn btn-pink" onClick={() => openPackageModal(primaryGroupOption)} disabled={crewSoldOut}>
                      {crewSoldOut ? "Sold out — a session is full" : `Book crew of ${primaryGroupOption.pax || 10} · ${formatEventPrice(primaryGroupOption.priceInr)}`}
                    </button>
                    <a className="btn btn-ghost btn-wa" href="https://wa.me/919205488417?text=Hi%2C%20I%27m%20booking%20a%20crew%20of%2010%20for%20Pink%27d" target="_blank" rel="noopener noreferrer">Talk to us first</a>
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
                    <div className="sub">Six full passes in one checkout.</div>
                  </div>
                  <div className="price-row">
                    <div className="price">{formatEventPrice(secondaryGroupOption.priceInr)}</div>
                    {secondaryGroupOption.pax ? (
                      <div className="perhead">
                        <b>{formatEventPrice(Math.round(secondaryGroupOption.priceInr / secondaryGroupOption.pax))} per head</b>
                        <small>vs {formatEventPrice(fullPassOption?.priceInr || 5500)} solo</small>
                      </div>
                    ) : null}
                  </div>
                  <span className="save">Saves {formatEventPrice(secondaryGroupSavings)}</span>
                  <ul className="incl">
                    <li><CheckCircle2 />All four intensives for all six</li>
                    <li><CheckCircle2 />Party entry x6 · wristbands · welcome drinks · 4 free games each</li>
                    <li><CheckCircle2 />Flat price, phase-proof</li>
                  </ul>
                  <div className="crew-actions">
                    <button type="button" className="btn btn-pink" onClick={() => openPackageModal(secondaryGroupOption)} disabled={isOptionSoldOut(secondaryGroupOption)}>
                      {isOptionSoldOut(secondaryGroupOption) ? "Sold out — a session is full" : `Book crew of ${secondaryGroupOption.pax || 6} · ${formatEventPrice(secondaryGroupOption.priceInr)}`}
                    </button>
                  </div>
                </div>
              </article>
            ) : null}
          </div>

          <p className="custom">
            Crew of 7, 12, 20? <a href="https://wa.me/919205488417?text=Hi%2C%20I%20want%20a%20custom%20crew%20quote%20for%20Pink%27d" target="_blank" rel="noopener noreferrer">Message us for a custom quote</a> — studios and colleges welcome.
          </p>

          <div className="divider">Individual passes</div>
          <div className="solo-grid">
            {individualPassOptions.map((option) => (
              <article className={`solo ${option.featured ? "rec" : ""}`} key={option.id}>
                {option.featured ? <span className="ribbon">Most popular</span> : null}
                {renderIndividualPassDetails(option)}
                <button
                  type="button"
                  className={`btn ${option.featured ? "btn-pink" : "btn-ghost"}`}
                  onClick={() => openPackageModal(option)}
                  disabled={isOptionSoldOut(option)}
                >
                  {getPassButtonLabel(option)}
                </button>
              </article>
            ))}
          </div>

          <div className="trust">
            <span><ShieldCheck />Secure payment via {getGatewayLabel(paymentProvider)} · UPI, cards, netbanking</span>
            <span><Mail />Instant confirmation by email</span>
            <span><CreditCard />Party is 18+ · ID checked at gate</span>
            <span><Coins />No refunds or transfers on any ticket</span>
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
                  alt="Pink'd event poster"
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
                        {selectedPackage.category === "party" && partyPhase ? `${partyPhase.name} price` : "Price"}
                      </div>
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
                              ? "Pick exactly 1 session"
                              : `Pick exactly ${selectedPackage.intensiveCount} sessions`}
                          </DropdownMenuLabel>
                          {sessionAvailability.map((session) => (
                            <DropdownMenuCheckboxItem
                              key={session.label}
                              checked={pendingSlots.includes(session.label)}
                              onCheckedChange={() => togglePendingSlot(session.label)}
                              onSelect={(event) => event.preventDefault()}
                              disabled={session.soldOut}
                            >
                              {session.label}
                              {session.soldOut ? " · Sold out" : session.warning ? ` · ${session.remaining} left` : ""}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {selectedPackage.intensiveCount >= EVENT_TIME_SLOTS.length ? (
                        <div className="space-y-2">
                          <div className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/62">
                            All 4 sessions are included and locked for this pass.
                          </div>
                          <div className="space-y-1">
                            {pendingSlots.map((slot) => (
                              <div key={slot} className="flex items-center justify-between gap-3 rounded-md bg-white/[0.05] px-3 py-2 text-sm text-white/72">
                                <span>{slot}</span>
                                {soldOutSlots.has(slot) ? <span className="text-xs font-bold uppercase text-[#ff5a3c]">Sold out</span> : null}
                              </div>
                            ))}
                          </div>
                          {isOptionSoldOut(selectedPackage) ? (
                            <div className="rounded-md border border-[#ff5a3c]/40 bg-[#ff5a3c]/10 px-3 py-2 text-sm text-white/80">
                              One of these sessions is full, so this pass can't be booked. Pick 1 or 2 Intensives for the sessions that still have seats.
                            </div>
                          ) : null}
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
                        <div className="text-sm text-white/52">
                          {selectedPackage.intensiveCount === 1 ? "Choose the session you want to attend." : `Choose ${selectedPackage.intensiveCount} sessions to attend.`}
                        </div>
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
                    disabled={isOptionSoldOut(selectedPackage)}
                    className="h-11 w-full bg-primary font-bold text-black hover:bg-primary/90 sm:w-auto"
                  >
                    {isOptionSoldOut(selectedPackage) ? "Sold out" : "Confirm & Add to Cart"}
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
              {confirmedOrder.status === "paid" && confirmedOrder.needsAttendeeForm ? (
                <a
                  href={`/attendees?ref=${confirmedOrder.id.slice(0, 8).toUpperCase()}`}
                  className="mt-2 inline-flex items-center gap-1 rounded-md bg-success/20 px-3 py-2 font-semibold text-success underline-offset-4 hover:underline"
                >
                  Add a name + phone for each wristband
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
              ) : null}
              {confirmedOrder.status === "paid" && confirmedOrder.includesParty ? (
                <div className="mt-2 text-success/85">
                  Want Pink'd Coins for the games? Your confirmation email has the link.
                </div>
              ) : null}
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
              {cartLines.length === 0 ? (
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
                          {line.option.category === "party" && partyPhase ? ` · ${partyPhase.name}` : ""}
                        </div>
                        {line.selectedTimeSlots.length > 0 && line.selectedTimeSlots.length < EVENT_TIME_SLOTS.length ? (
                          <div className="mt-1 text-xs text-white/52">{line.selectedTimeSlots.map(shortSlotLabel).join(" · ")}</div>
                        ) : null}
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

            </div>

            <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-sm">
              <div className="flex items-center justify-between text-white/62">
                <span>Event passes</span>
                <span>{formatEventPrice(eventSubtotal)}</span>
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
              Secure payment via {getGatewayLabel(paymentProvider)} · UPI, cards and netbanking.
            </div>

            <div className="mt-3 rounded-md border border-white/12 bg-black/35 p-3 text-sm font-bold uppercase leading-6 text-white/78">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <div>Party is 18+ · valid ID checked at the gate.</div>
                  <div>No refunds · no transfers · any ticket.</div>
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
              Anything else — the WhatsApp line is open till the doors close on the 11th.
            </p>
            <a className="btn btn-ghost btn-wa" href="https://wa.me/919205488417" target="_blank" rel="noopener noreferrer">WhatsApp the team</a>
          </div>
          <div className="acc">
          {[
            [
              "How does a group booking work?",
              "One person pays for the whole crew in a single checkout. The order stores the package, quantity, selected time slots, customer details, and payment status for admin reporting.",
            ],
            [
              "Can I buy party entries for friends?",
              "Yes — add one Party Entry per person in the cart and pay once. Each name gets its own wristband at the gate, and everyone must be 18+ with ID.",
            ],
            [
              "What's included in party entry?",
              "Entry to Glass Villa on Friday 11 September, your Pink'd wristband, a welcome drink, and four games free: Beer Pong, the Jamaal Challenge, Red Flag Green Flag and Squid Games. Everything else on the night runs on Pink'd Coins, which you load onto the band at the venue.",
            ],
            [
              "Why does the party price change?",
              "Party entry is ₹2,000 for the first 50 spots, ₹2,499 for spots 51–150, and ₹2,999 after that. The price you see is locked for 15 minutes once you hit Pay.",
            ],
            [
              "Do I pick my intensive sessions?",
              smallIntensivePassesLive
                ? "A 4-intensive or full pass covers all four sessions across both evenings. With 1 Intensive you pick any one session, with 2 Intensives any two — day and time only; styles are announced closer to the date. Each session is capped at 120 seats, and a full session is greyed out in the picker."
                : "A 4-intensive or full pass covers all four sessions across both evenings. Each session is capped at 120 seats. Styles are announced closer to the date.",
            ],
            [
              "How do I get Pink'd Coins for the games?",
              "Coins aren't sold with tickets. Once you hold a paid party ticket, your confirmation email carries a private link where you can buy coin packs against your order; they're loaded onto your wristband at the gate. You can also top up at the venue.",
            ],
            [
              "Is there an age limit?",
              "The intensives are open to all. The party on the 11th is strictly 18+ with ID checked at the gate. If you're under 18 and buy a full pass, the party portion is forfeited at the door — no refund — so please book intensives-only.",
            ],
            [
              "Can I get a refund or give my ticket to a friend?",
              "No. All tickets, including group passes, are non-refundable and non-transferable. Please double-check dates and attendees before you pay.",
            ],
            [
              "Where does the money go?",
              "Once the event breaks even, every rupee goes to Hashtag's scholarship programme, which trains dancers across five forms who couldn't otherwise afford it. Nobody takes a cut. Pink'd has run this way for seven years.",
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
              Ten of you. Four intensives. One night that doesn't end. {primaryGroupOption?.pax ? `${formatEventPrice(Math.round(primaryGroupOption.priceInr / primaryGroupOption.pax))} a head` : "A crew pass"} — and a dancer somewhere gets to train because you showed up.
            </p>
            <div className="hero-cta">
            {primaryGroupOption ? (
              <button type="button" className="btn btn-pink" onClick={() => openPackageModal(primaryGroupOption)}>
                Book crew of {primaryGroupOption.pax || 10} · {formatEventPrice(primaryGroupOption.priceInr)}
              </button>
            ) : null}
              <a className="btn btn-ghost" href="#passes">See all passes</a>
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <span>Pink'd · A <b>FUN'draiser</b> by Hashtag For Dance · 7 years of Pink'd · 2026</span>
          <span>Payments processed by {getGatewayLabel(paymentProvider)} · Tickets are non-refundable and non-transferable</span>
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
        className={`sticky-cta ${showBottomSticker && !isCartOpen && !isGatewayActive ? "show" : ""}`}
      >
        <span className="pulse" />
        <span className="t">
          <b>{hasCheckoutItems ? cartBannerTitle : "9 - 11 Sep · Rajouri Garden & Gurugram"}</b>
          <small>{stickySubText}</small>
        </span>
        {hasCheckoutItems ? <span className="total">{formatEventPrice(grandTotal)}</span> : null}
        <span className="btn btn-pink btn-sm">{hasCheckoutItems ? "Review & pay" : "Book now"}</span>
      </button>
    </main>
  );
}
