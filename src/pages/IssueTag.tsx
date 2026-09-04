import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { nfcManager, NFCScanState , allowTypedTag } from "@/utils/nfc";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";
import {
  NfcIcon as Nfc,
  Scan,
  CheckCircle,
  AlertCircle,
  User,
  Phone,
  Tag,
  Building,
  Search,
  Coins,
  Ticket,
  RefreshCw,
  X
} from "lucide-react";

// New RPCs (staff_lookup_party_order / credit_prepaid_coins_to_wallet) are called
// through a loosely typed helper until types.ts picks them up (see TYPES_ADDITIONS_wallet.md).
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

const formatPinkdCoins = (value: number): string => `${Math.round(value).toLocaleString("en-IN")} Pink'd Coins`;

interface BookingItem {
  package_name: string;
  quantity: number;
}

interface BookingAttendee {
  position: number;
  attendee_name: string;
  attendee_phone: string;
}

interface BookingLookup {
  order_id: string;
  order_ref: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_studio: string | null;
  party_entries: number;
  items: BookingItem[];
  prepaid_coins: number;
  coins_credited: number;
  attendees: BookingAttendee[];
}

interface OrderBand {
  wallet_id: string;
  attendee_name: string;
  attendee_phone: string;
  tag_id: string;
  band_hint: string;
  coin_balance: number;
  status: string;
}

interface CreditResult {
  credited: number;
  prepaid_coins: number;
  coins_credited: number;
  new_balance: number;
  order_ref: string;
}

interface PendingCredit {
  walletId: string;
  orderId: string;
  orderRef: string;
  attendeeName: string;
  coins: number;
}

// Dropdown value -> label. Values are the studio codes stored in wallets.studio.
const STUDIO_OPTIONS: { value: string; label: string }[] = [
  { value: "NDA", label: "NDA" },
  { value: "RG", label: "RG" },
  { value: "ED", label: "ED" },
  { value: "PP", label: "PP" },
  { value: "SD", label: "SD" },
  { value: "GGN", label: "GGN" },
  { value: "IPM", label: "IPM" },
  { value: "RMG", label: "RMG" },
  { value: "AV", label: "AV" },
  { value: "DWK", label: "DWK" },
  { value: "GUEST", label: "Guest / not a student" },
];

const GUEST_STUDIO = "GUEST";

/**
 * Maps a booking's customer_studio ("Rajouri Garden (RG)", "Not a Student", ...)
 * onto a dropdown value. Returns "" when nothing obvious matches.
 */
function mapBookingStudio(customerStudio: string | null | undefined): string {
  const raw = (customerStudio ?? "").trim();
  if (!raw) return "";
  if (/not\s+a\s+student|guest/i.test(raw)) return GUEST_STUDIO;

  const inParens = raw.match(/\(([A-Za-z]{2,5})\)\s*$/);
  const code = (inParens ? inParens[1] : raw).toUpperCase();
  return STUDIO_OPTIONS.some((option) => option.value === code) ? code : "";
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseBookingLookup(data: unknown): BookingLookup | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  if (typeof raw.order_id !== "string") return null;

  const items = Array.isArray(raw.items)
    ? (raw.items as Record<string, unknown>[]).map((item) => ({
        package_name: String(item.package_name ?? ""),
        quantity: toNumber(item.quantity),
      }))
    : [];

  const attendees = Array.isArray(raw.attendees)
    ? (raw.attendees as Record<string, unknown>[])
        .map((attendee) => ({
          position: toNumber(attendee.position),
          attendee_name: String(attendee.attendee_name ?? "").trim(),
          attendee_phone: String(attendee.attendee_phone ?? "").trim(),
        }))
        .filter((attendee) => attendee.attendee_name.length > 0)
    : [];

  return {
    order_id: raw.order_id,
    order_ref: String(raw.order_ref ?? raw.order_id.slice(0, 8).toUpperCase()),
    customer_name: String(raw.customer_name ?? ""),
    customer_phone: String(raw.customer_phone ?? ""),
    customer_email: String(raw.customer_email ?? ""),
    customer_studio: typeof raw.customer_studio === "string" ? raw.customer_studio : null,
    party_entries: toNumber(raw.party_entries),
    items,
    prepaid_coins: toNumber(raw.prepaid_coins),
    coins_credited: toNumber(raw.coins_credited),
    attendees,
  };
}

function parseCreditResult(data: unknown): CreditResult | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  return {
    credited: toNumber(raw.credited),
    prepaid_coins: toNumber(raw.prepaid_coins),
    coins_credited: toNumber(raw.coins_credited),
    new_balance: toNumber(raw.new_balance),
    order_ref: String(raw.order_ref ?? ""),
  };
}

export default function IssueTag() {
  const { toast } = useToast();
  const [scanState, setScanState] = useState<NFCScanState>({ isScanning: false, duration: 0 });
  const [scannedTag, setScannedTag] = useState<string | null>(null);
  const [attendeeName, setAttendeeName] = useState("");
  const [attendeePhone, setAttendeePhone] = useState("");
  const [selectedStudio, setSelectedStudio] = useState<string>("");
  const [isIssuing, setIsIssuing] = useState(false);

  // Booking lookup
  const [lookupQuery, setLookupQuery] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [booking, setBooking] = useState<BookingLookup | null>(null);
  const bookingOrderId = booking?.order_id ?? null;
  const [lookupMiss, setLookupMiss] = useState<string | null>(null);

  // Prepaid coins that failed to load after the wallet was created (retry)
  const [pendingCredit, setPendingCredit] = useState<PendingCredit | null>(null);
  const [loadPrepaidOnThisBand, setLoadPrepaidOnThisBand] = useState(true);
  const [duplicatePhoneAcknowledged, setDuplicatePhoneAcknowledged] = useState(false);
  const [orderBands, setOrderBands] = useState<OrderBand[]>([]);
  const [devTagInput, setDevTagInput] = useState("");
  const [reissuingWalletId, setReissuingWalletId] = useState<string | null>(null);

  const loadOrderBands = useCallback(async (orderId: string) => {
    const { data, error } = await rpc("staff_list_bands_for_order", { p_parent_order_id: orderId });
    if (error || !Array.isArray(data)) {
      setOrderBands([]);
      return;
    }
    setOrderBands(
      (data as Array<Record<string, unknown>>).map((band) => ({
        wallet_id: String(band.wallet_id),
        attendee_name: String(band.attendee_name ?? ""),
        attendee_phone: String(band.attendee_phone ?? ""),
        tag_id: String(band.tag_id ?? ""),
        band_hint: String(band.band_hint ?? ""),
        coin_balance: Number(band.coin_balance ?? 0),
        status: String(band.status ?? "active"),
      })),
    );
  }, []);

  // Lost or broken band: block it, move the balance onto the band just scanned.
  const handleReissue = async (band: OrderBand) => {
    if (!scannedTag) {
      toast({
        title: "Scan the replacement first",
        description: "Scan the new band, then tap Reissue on the lost one.",
        variant: "destructive",
      });
      return;
    }
    if (!window.confirm(`Block band ···${band.band_hint} (${band.attendee_name}) and move ${band.coin_balance.toLocaleString("en-IN")} Pink'd Coins onto ${scannedTag}?`)) {
      return;
    }
    setReissuingWalletId(band.wallet_id);
    try {
      const { data, error } = await rpc("reissue_wallet", {
        p_old_wallet_id: band.wallet_id,
        p_new_tag_id: scannedTag,
        p_reason: "lost",
      });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as { moved_coins?: number; new_tag_id?: string };
      toast({
        title: "Band Reissued",
        description: `${band.attendee_name} is now on ${result.new_tag_id || scannedTag} with ${Number(result.moved_coins || 0).toLocaleString("en-IN")} Pink'd Coins. The old band is blocked.`,
      });
      setScannedTag(null);
      if (booking) await loadOrderBands(booking.order_id);
    } catch (error) {
      toast({
        title: "Reissue Failed",
        description: error instanceof Error ? error.message : "Could not reissue this band.",
        variant: "destructive",
      });
    } finally {
      setReissuingWalletId(null);
    }
  };
  const [isRetryingCredit, setIsRetryingCredit] = useState(false);

  const coinsWaiting = booking ? Math.max(0, booking.prepaid_coins - booking.coins_credited) : 0;

  useEffect(() => {
    if (bookingOrderId) {
      void loadOrderBands(bookingOrderId);
    } else {
      setOrderBands([]);
    }
  }, [bookingOrderId, loadOrderBands]);

  useEffect(() => {
    // Set up scan state callback
    nfcManager.setScanStateCallback(setScanState);

    return () => {
      // Cleanup on unmount
      nfcManager.stopScanning();
    };
  }, []);

  const resetForm = () => {
    setScannedTag(null);
    setAttendeeName("");
    setAttendeePhone("");
    setDuplicatePhoneAcknowledged(false);
    setSelectedStudio("");
  };

  const clearBooking = () => {
    setBooking(null);
    setLookupMiss(null);
    setLookupQuery("");
  };

  const handleLookup = async (event?: FormEvent) => {
    event?.preventDefault();
    const query = lookupQuery.trim();
    if (!query) return;

    setIsLookingUp(true);
    setLookupMiss(null);
    try {
      const { data, error } = await rpc("staff_lookup_party_order", { p_query: query });
      if (error) {
        throw new Error(error.message);
      }

      const found = parseBookingLookup(data);
      if (!found) {
        setBooking(null);
        setLookupMiss(query);
        return;
      }

      setBooking(found);

      // Autofill straight away when the form is still empty; otherwise leave the staff's typing alone.
      if (!attendeeName && !attendeePhone) {
        applyBookingDetails(found);
      }
    } catch (error) {
      console.error("Booking lookup failed:", error);
      toast({
        title: "Lookup Failed",
        description: error instanceof Error ? error.message : "Could not search bookings. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLookingUp(false);
    }
  };

  const applyBookingDetails = (source: BookingLookup) => {
    setAttendeeName(source.customer_name);
    setAttendeePhone(source.customer_phone);
    const mappedStudio = mapBookingStudio(source.customer_studio);
    if (mappedStudio) {
      setSelectedStudio(mappedStudio);
    }
  };

  const applyAttendee = (attendee: BookingAttendee) => {
    if (!booking) return;
    setAttendeeName(attendee.attendee_name);
    setAttendeePhone(attendee.attendee_phone || booking.customer_phone);
    const mappedStudio = mapBookingStudio(booking.customer_studio);
    if (mappedStudio && !selectedStudio) {
      setSelectedStudio(mappedStudio);
    }
  };

  const handleNFCScan = async () => {
    // If already scanned, reset and start new scan
    if (scannedTag && !scanState.isScanning) {
      resetForm();
      if (booking) {
        applyBookingDetails(booking);
      }
    }

    if (scanState.isScanning) {
      console.log('Scan already in progress, ignoring request');
      return;
    }

    try {
      // Always stop any existing scan first to prevent conflicts
      nfcManager.stopScanning();

      console.log('Starting new NFC scan...');
      const result = await nfcManager.startScanning();

      if (result.success) {
        setScannedTag(result.tagId);
        toast({
          title: "NFC Tag Scanned",
          description: `Successfully scanned tag: ${result.tagId}`,
        });
      } else {
        toast({
          title: "Scanning Failed",
          description: result.error || "Could not scan NFC tag. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('NFC scan error in component:', error);
      toast({
        title: "Scanning Failed",
        description: "Could not scan NFC tag. Please try again.",
        variant: "destructive",
      });
    }
  };

  /**
   * Loads the coins bought online against the booking onto the wallet.
   * Returns the number of coins credited (0 when nothing was waiting).
   */
  const creditPrepaidCoins = async (orderId: string, walletId: string, loadPrepaid = true): Promise<CreditResult> => {
    // Links the band to the booking (so later online top-ups land on it automatically)
    // and, when asked, loads anything already paid for. Idempotent on the server.
    const { data, error } = await rpc("link_wallet_to_event_order", {
      p_wallet_id: walletId,
      p_parent_order_id: orderId,
      p_load_prepaid: loadPrepaid,
    });
    if (error) {
      throw new Error(error.message);
    }
    const result = parseCreditResult(data);
    if (!result) {
      throw new Error("Unexpected response while loading prepaid coins");
    }
    return result;
  };

  const handleRetryCredit = async () => {
    if (!pendingCredit) return;
    setIsRetryingCredit(true);
    try {
      const result = await creditPrepaidCoins(pendingCredit.orderId, pendingCredit.walletId);
      if (result.credited > 0) {
        toast({
          title: "Prepaid Coins Loaded",
          description: `Loaded ${result.credited.toLocaleString("en-IN")} prepaid Pink'd Coins onto the band for ${pendingCredit.attendeeName}.`,
        });
      } else {
        toast({
          title: "Nothing Left To Load",
          description: `Order ${pendingCredit.orderRef} has no prepaid Pink'd Coins waiting.`,
        });
      }
      setPendingCredit(null);
      if (booking && booking.order_id === pendingCredit.orderId) {
        setBooking({ ...booking, coins_credited: result.coins_credited, prepaid_coins: result.prepaid_coins });
      }
    } catch (error) {
      console.error("Prepaid coin retry failed:", error);
      toast({
        title: "Coins Not Loaded",
        description: error instanceof Error ? error.message : "Could not load prepaid coins. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRetryingCredit(false);
    }
  };

  const handleIssueWallet = async () => {
    if (!scannedTag || !attendeeName || !attendeePhone || !selectedStudio) {
      toast({
        title: "Missing Information",
        description: "Please scan a tag and fill in all attendee details including studio.",
        variant: "destructive",
      });
      return;
    }

    setIsIssuing(true);
    try {
      // Check if tag already exists
      const { data: existingWallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('tag_id', scannedTag)
        .maybeSingle();

      if (existingWallet) {
        toast({
          title: "Tag Already Used",
          description: "This NFC tag is already linked to a wallet.",
          variant: "destructive",
        });
        return;
      }

      // Same phone already wearing a band on this booking? Warn, but let staff decide.
      if (booking) {
        const { data: bandCheck } = await rpc("phone_has_band_on_order", {
          p_parent_order_id: booking.order_id,
          p_phone: attendeePhone.trim(),
        });
        const check = (bandCheck ?? {}) as { has_band?: boolean; attendee_name?: string; band_hint?: string };
        if (check.has_band && !duplicatePhoneAcknowledged) {
          setDuplicatePhoneAcknowledged(true);
          toast({
            title: "This phone already has a band",
            description: `${check.attendee_name || "Someone"} on order ${booking.order_ref} already has band ···${check.band_hint || "?"} with this number. Each guest needs their own phone for top-ups. Tap Create again to issue anyway.`,
            variant: "destructive",
          });
          return;
        }
      }

      // Create wallet in Supabase
      const walletInsert: TablesInsert<"wallets"> = {
        tag_id: scannedTag,
        attendee_name: attendeeName.trim(),
        attendee_phone: attendeePhone.trim(),
        studio: selectedStudio,
        balance: 0.00,
        coin_balance: 0,
        status: 'active'
      };

      const { data, error } = await supabase
        .from('wallets')
        .insert(walletInsert)
        .select('id')
        .single();

      if (error || !data) {
        throw error ?? new Error("Wallet was not created");
      }

      const walletId = (data as { id: string }).id;

      toast({
        title: "Wallet Created Successfully",
        description: `Digital wallet created for ${attendeeName} with tag ${scannedTag}`,
      });
      if (booking) void loadOrderBands(booking.order_id);

      // Link the band to the booking and load coins bought online (once per order).
      if (booking) {
        const creditContext: PendingCredit = {
          walletId,
          orderId: booking.order_id,
          orderRef: booking.order_ref,
          attendeeName: attendeeName.trim(),
          coins: coinsWaiting,
        };
        try {
          const result = await creditPrepaidCoins(booking.order_id, walletId, coinsWaiting > 0 ? loadPrepaidOnThisBand : true);
          if (result.credited > 0) {
            toast({
              title: "Prepaid Coins Loaded",
              description: `Loaded ${result.credited.toLocaleString("en-IN")} prepaid Pink'd Coins onto the band.`,
            });
          } else if (coinsWaiting > 0 && !loadPrepaidOnThisBand) {
            toast({
              title: "Band Linked",
              description: `${formatPinkdCoins(coinsWaiting)} from order ${booking.order_ref} are still waiting for another band.`,
            });
          }
          setBooking({ ...booking, coins_credited: result.coins_credited, prepaid_coins: result.prepaid_coins });
        } catch (creditError) {
          console.error("Prepaid coin credit failed:", creditError);
          setPendingCredit(creditContext);
          toast({
            title: "Coins Not Loaded Yet",
            description: coinsWaiting > 0
              ? `The band was issued, but ${formatPinkdCoins(coinsWaiting)} from order ${booking.order_ref} could not be loaded. Use "Retry loading coins" below.`
              : `The band was issued, but it could not be linked to order ${booking.order_ref} for online top-ups. Use "Retry loading coins" below.`,
            variant: "destructive",
          });
        }
      }

      // Reset form (keep the booking card so the next crew member can be issued from it)
      resetForm();
    } catch (error) {
      console.error("Wallet creation failed:", error);
      toast({
        title: "Failed to Create Wallet",
        description: "There was an error creating the wallet. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsIssuing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 sm:space-y-8 pb-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Issue NFC Tag</h1>
        <p className="text-muted-foreground mt-2">Scan the band's default NFC UID and create a Pink'd Coin wallet</p>
      </div>

      {/* Find Booking Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Ticket className="w-5 h-5 text-primary" />
            <span>Find Booking</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleLookup} className="flex flex-col sm:flex-row gap-2">
            <Input
              id="booking-lookup"
              placeholder="Phone, email or order ref"
              value={lookupQuery}
              onChange={(e) => setLookupQuery(e.target.value)}
              inputMode="search"
              autoComplete="off"
              enterKeyHint="search"
              className="transition-smooth focus:shadow-hover text-base"
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={isLookingUp || !lookupQuery.trim()}
                className="flex-1 sm:flex-none bg-gradient-primary hover:shadow-hover transition-smooth"
              >
                {isLookingUp ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    <span>Searching...</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <Search className="w-4 h-4" />
                    <span>Find</span>
                  </div>
                )}
              </Button>
              {(booking || lookupMiss) && (
                <Button type="button" variant="outline" onClick={clearBooking} aria-label="Clear booking">
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </form>

          {lookupMiss && !booking && (
            <div className="bg-muted/60 border border-border rounded-lg p-3 text-sm text-muted-foreground">
              No paid party ticket found for <span className="font-medium text-foreground">{lookupMiss}</span>.
              Fill the details in manually below.
            </div>
          )}

          {booking && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{booking.customer_name}</div>
                  <div className="text-sm text-muted-foreground break-words">
                    order {booking.order_ref} · {booking.party_entries} {booking.party_entries === 1 ? "entry" : "entries"}
                    {booking.customer_studio ? ` · ${booking.customer_studio}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 break-all">
                    {booking.customer_phone}{booking.customer_email ? ` · ${booking.customer_email}` : ""}
                  </div>
                </div>
                <CheckCircle className="w-5 h-5 text-success shrink-0" />
              </div>

              {coinsWaiting > 0 && booking.party_entries > 1 ? (
                <label className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={loadPrepaidOnThisBand}
                    onChange={(event) => setLoadPrepaidOnThisBand(event.target.checked)}
                  />
                  <span>Load the {coinsWaiting.toLocaleString("en-IN")} waiting coins onto THIS band (untick if they belong to someone else in the group)</span>
                </label>
              ) : null}
              <div className="flex items-center space-x-2 text-sm">
                <Coins className={`w-4 h-4 ${coinsWaiting > 0 ? "text-primary" : "text-muted-foreground"}`} />
                <span className={coinsWaiting > 0 ? "font-medium text-foreground" : "text-muted-foreground"}>
                  {coinsWaiting > 0
                    ? `${coinsWaiting.toLocaleString("en-IN")} Pink'd Coins waiting to load`
                    : booking.prepaid_coins > 0
                      ? `${booking.prepaid_coins.toLocaleString("en-IN")} prepaid Pink'd Coins already loaded`
                      : "No Pink'd Coins bought online"}
                </span>
              </div>

              {booking.items.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {booking.items.map((item, index) => (
                    <Badge key={`${item.package_name}-${index}`} variant="outline" className="font-normal">
                      {item.quantity} × {item.package_name}
                    </Badge>
                  ))}
                </div>
              )}

              {orderBands.length > 0 && (
                <div className="rounded-md border border-border bg-background/60 p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Bands already issued on this booking
                  </div>
                  {orderBands.map((band) => (
                    <div key={band.wallet_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium text-foreground">{band.attendee_name}</span>
                        <span className="text-muted-foreground"> · ···{band.band_hint} · {band.coin_balance.toLocaleString("en-IN")} coins</span>
                        {band.status !== "active" ? <Badge variant="outline" className="ml-2 font-normal">{band.status}</Badge> : null}
                      </div>
                      {band.status === "active" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!scannedTag || reissuingWalletId === band.wallet_id}
                          onClick={() => handleReissue(band)}
                          title={scannedTag ? `Move this person onto ${scannedTag}` : "Scan the replacement band first"}
                        >
                          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${reissuingWalletId === band.wallet_id ? "animate-spin" : ""}`} />
                          Reissue lost band
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Lost a band? Scan the replacement above, then tap Reissue. The old band is blocked and the balance moves across.
                  </p>
                </div>
              )}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyBookingDetails(booking)}
                className="w-full sm:w-auto"
              >
                <User className="w-4 h-4 mr-2" />
                Use booking name & phone
              </Button>

              {booking.attendees.length > 0 && (
                <div className="space-y-2 pt-1">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Wristband names (tap to fill)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {booking.attendees.map((attendee) => (
                      <button
                        key={`${attendee.position}-${attendee.attendee_name}`}
                        type="button"
                        onClick={() => applyAttendee(attendee)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition-smooth ${
                          attendeeName === attendee.attendee_name
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-border hover:border-primary"
                        }`}
                      >
                        {attendee.position}. {attendee.attendee_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {pendingCredit && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 space-y-2">
              <div className="text-sm text-foreground">
                {formatPinkdCoins(pendingCredit.coins)} from order {pendingCredit.orderRef} are still waiting to load onto{" "}
                {pendingCredit.attendeeName}'s band.
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleRetryCredit}
                  disabled={isRetryingCredit}
                  className="bg-gradient-primary"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${isRetryingCredit ? "animate-spin" : ""}`} />
                  Retry loading coins
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPendingCredit(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* NFC Scanning Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Nfc className="w-5 h-5 text-primary" />
            <span>NFC Tag Scanner</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Scan Button */}
          <div className="text-center space-y-4">
            <div className={`relative ${scanState.isScanning ? 'animate-pulse' : ''}`}>
              <Button
                onClick={handleNFCScan}
                disabled={scanState.isScanning}
                size="lg"
                className="w-full max-w-xs bg-gradient-primary hover:shadow-hover transition-smooth"
              >
                {scanState.isScanning ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    <span>Scanning...</span>
                  </div>
                ) : scannedTag ? (
                  <div className="flex items-center space-x-2">
                    <Scan className="w-5 h-5" />
                    <span>Scan New Tag</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <Scan className="w-5 h-5" />
                    <span>Scan NFC Tag</span>
                  </div>
                )}
              </Button>

              {/* Scanning pulse effect */}
              {scanState.isScanning && (
                <div className="absolute inset-0 rounded-md bg-primary/20 animate-ping pointer-events-none" />
              )}
            </div>

            {allowTypedTag() ? (
              <form
                className="mx-auto flex max-w-xs items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = devTagInput.trim().toUpperCase();
                  if (value.length < 4) return;
                  setScannedTag(value);
                  setDuplicatePhoneAcknowledged(false);
                  setDevTagInput("");
                }}
              >
                <Input
                  value={devTagInput}
                  onChange={(event) => setDevTagInput(event.target.value)}
                  placeholder="Type a tag ID (test mode, no NFC on this device)"
                  autoComplete="off"
                  className="text-sm"
                />
                <Button type="submit" variant="outline" size="sm">Use</Button>
              </form>
            ) : null}

            {/* Scanning Status */}
            {scanState.isScanning && (
              <div className="space-y-3 animate-fade-in">
                <div className="flex items-center justify-center space-x-2 text-primary">
                  <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                  <span className="font-medium">Scanning...</span>
                  <div className="w-2 h-2 bg-primary rounded-full animate-pulse animation-delay-150" />
                </div>

                <div className="text-sm text-muted-foreground space-y-1">
                  <div>Duration: {Math.floor(scanState.duration / 1000)}s</div>
                  <div className="text-xs">Hold your device near the NFC tag</div>
                  {scanState.lastError && (
                    <div className="text-xs text-orange-500 animate-fade-in">
                      {scanState.lastError}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Scanned Tag Display */}
          {scannedTag && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-4 flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-success" />
              <div>
                <div className="font-medium text-foreground">Tag Scanned Successfully</div>
                <div className="text-sm text-muted-foreground">
                  Tag ID: <Badge variant="outline" className="ml-1">{scannedTag}</Badge>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendee Information Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <User className="w-5 h-5 text-primary" />
            <span>Attendee Information</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="flex items-center space-x-2">
              <User className="w-4 h-4" />
              <span>Full Name</span>
            </Label>
            <Input
              id="name"
              placeholder="Enter attendee's full name"
              value={attendeeName}
              onChange={(e) => setAttendeeName(e.target.value)}
              autoComplete="off"
              className="transition-smooth focus:shadow-hover text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="flex items-center space-x-2">
              <Phone className="w-4 h-4" />
              <span>Phone Number</span>
            </Label>
            <Input
              id="phone"
              placeholder="Enter phone number"
              value={attendeePhone}
              onChange={(e) => { setAttendeePhone(e.target.value); setDuplicatePhoneAcknowledged(false); }}
              inputMode="tel"
              autoComplete="off"
              className="transition-smooth focus:shadow-hover text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="studio" className="flex items-center space-x-2">
              <Building className="w-4 h-4" />
              <span>Studio</span>
            </Label>
            <Select value={selectedStudio} onValueChange={setSelectedStudio}>
              <SelectTrigger id="studio" className="transition-smooth focus:shadow-hover">
                <SelectValue placeholder="Select studio" />
              </SelectTrigger>
              <SelectContent>
                {STUDIO_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Issue Wallet Button */}
      <div className="text-center space-y-2">
        <Button
          onClick={handleIssueWallet}
          disabled={!scannedTag || !attendeeName || !attendeePhone || !selectedStudio || isIssuing}
          size="lg"
          className="w-full max-w-xs bg-gradient-primary hover:shadow-hover transition-smooth"
        >
          {isIssuing ? (
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              <span>Creating...</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <Tag className="w-5 h-5" />
              <span>Create Digital Wallet</span>
            </div>
          )}
        </Button>
        {booking && coinsWaiting > 0 && (
          <div className="text-xs text-muted-foreground">
            {coinsWaiting.toLocaleString("en-IN")} prepaid Pink'd Coins will be loaded onto this band automatically.
          </div>
        )}
      </div>

      {/* Info Card */}
      <Card className="shadow-card bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-2">Phone NFC Support:</p>
              <ul className="space-y-1">
                <li>• Needs Chrome on Android with NFC turned on — iPhones cannot scan</li>
                <li>• Uses the WebNFC API to read the band's factory UID</li>
                <li>• Supports NTAG213/215/216 compatible NFC tags</li>
                <li>• Look the booking up first so the name, phone and prepaid coins fill in automatically</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
