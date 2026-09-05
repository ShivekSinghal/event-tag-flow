import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Clock, Loader2, Minus, Plus, Search, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { toIntegerCoins } from "@/lib/coins";
import { formatEventPrice } from "@/lib/eventPackages";
import {
  createCheckoutToken,
  getGatewayLabel,
  getPaymentErrorMessage,
  runGatewayPayment,
  sha256Hex,
  type PaymentProvider,
} from "@/lib/checkoutGateway";
import { captureLandingAttribution, getLandingAttribution, trackPurchaseOnce, type TrackingCartItem } from "@/lib/tracking";

/**
 * /coins — gated Pink'd Coins shop for people who already hold a paid party
 * ticket. Not linked from the booking page; reached from the confirmation
 * email (`/coins?ref=XXXXXXXX`) or WhatsApp. `noindex` while mounted.
 */

const WHATSAPP_URL = "https://wa.me/919205488417";
const LOGO_SRC = "/media/pinkd-logo.png";
const MAX_PACK_QUANTITY = 20;

type CoinPack = { id: string; inr_amount: number; coin_amount: number; display_order: number };

type PartyLookup = {
  order_id: string;
  order_ref: string;
  first_name: string;
  party_entries: number;
  coins_purchased: number;
  coins_pending: number;
  coins_waiting: number;
  wallet_linked: boolean;
  band_count: number;
  bands: PartyBand[];
  matched_wallet_id: string | null;
  coin_balance: number;
  band_hint: string | null;
  paid_at: string | null;
};

type PartyBand = {
  wallet_id: string;
  name: string;
  band_hint: string;
  coin_balance: number;
};

type LookupState = "idle" | "loading" | "not_found" | "found";

type PaidState = { orderId: string; coins: number; amountInr: number; isPaid: boolean; provider: PaymentProvider };

// Coin label kept local so this page controls its own copy.
const formatCoinLabel = (value: unknown) => `${toIntegerCoins(value).toLocaleString("en-IN")} Pink'd Coins`;

function parseLookup(data: unknown): PartyLookup | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (typeof record.order_id !== "string" || typeof record.order_ref !== "string") return null;
  return {
    order_id: record.order_id,
    order_ref: record.order_ref,
    first_name: typeof record.first_name === "string" && record.first_name ? record.first_name : "there",
    party_entries: toIntegerCoins(record.party_entries),
    coins_purchased: toIntegerCoins(record.coins_purchased),
    coins_pending: toIntegerCoins(record.coins_pending),
    coins_waiting: toIntegerCoins(record.coins_waiting),
    wallet_linked: record.wallet_linked === true,
    band_count: toIntegerCoins(record.band_count),
    bands: Array.isArray(record.bands)
      ? (record.bands as Array<Record<string, unknown>>)
          .filter((band) => typeof band?.wallet_id === "string")
          .map((band) => ({
            wallet_id: String(band.wallet_id),
            name: typeof band.name === "string" && band.name ? band.name : "Guest",
            band_hint: typeof band.band_hint === "string" ? band.band_hint : "",
            coin_balance: toIntegerCoins(band.coin_balance),
          }))
      : [],
    matched_wallet_id: typeof record.matched_wallet_id === "string" ? record.matched_wallet_id : null,
    coin_balance: toIntegerCoins(record.coin_balance),
    band_hint: typeof record.band_hint === "string" ? record.band_hint : null,
    paid_at: typeof record.paid_at === "string" ? record.paid_at : null,
  };
}

const panelClass = "border-white/10 bg-white/[0.04] text-white";
const inputClass =
  "h-12 rounded-xl border-white/15 bg-white/5 text-base text-white placeholder:text-white/35 focus-visible:ring-primary focus-visible:ring-offset-0";
const outlineButtonClass = "border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white";
const stepperButtonClass = `h-11 w-11 rounded-full ${outlineButtonClass}`;

export default function CoinsPage() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const refFromUrl = (searchParams.get("ref") || "").trim().toUpperCase();

  const [refInput, setRefInput] = useState(refFromUrl);
  const [contactInput, setContactInput] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>("idle");
  const [lookup, setLookup] = useState<PartyLookup | null>(null);
  const [proof, setProof] = useState(""); // what the visitor typed; re-sent as proof when ordering
  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);

  const [packs, setPacks] = useState<CoinPack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const [provider, setProvider] = useState<PaymentProvider>("cashfree");
  const [isPaying, setIsPaying] = useState(false);
  const [isGatewayOpening, setIsGatewayOpening] = useState(false);
  const [paid, setPaid] = useState<PaidState | null>(null);
  const paymentAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => paymentAbortControllerRef.current?.abort(), []);

  // Page chrome: attribution, noindex, title.
  useEffect(() => {
    captureLandingAttribution();
    const previousTitle = document.title;
    document.title = "Pink'd Coins";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.title = previousTitle;
      meta.remove();
    };
  }, []);

  // Coin packs and the active gateway label.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [packsResult, gatewayResult] = await Promise.all([
        supabase
          .from("coin_packages")
          .select("id, inr_amount, coin_amount, active, display_order")
          .eq("active", true)
          .order("display_order", { ascending: true }),
        supabase.from("payment_gateway_settings").select("active_provider").eq("id", "event_bookings").single(),
      ]);
      if (cancelled) return;

      if (packsResult.error) {
        toast({ title: "Couldn't load coin packs", description: packsResult.error.message, variant: "destructive" });
      } else {
        setPacks(
          (packsResult.data || []).map((row) => ({
            id: row.id,
            inr_amount: Number(row.inr_amount),
            coin_amount: toIntegerCoins(row.coin_amount),
            display_order: row.display_order,
          })),
        );
      }
      setPacksLoading(false);
      setProvider(gatewayResult.data?.active_provider === "razorpay" ? "razorpay" : "cashfree");
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const runLookup = useCallback(
    async (orderRef: string, contact: string) => {
      const cleanRef = orderRef.trim().toUpperCase();
      const cleanContact = contact.trim();
      const useRef = cleanRef.length >= 6;

      if (!useRef && !cleanContact) {
        toast({ title: "Enter your order reference, or the email or phone you booked with." });
        return;
      }

      setLookupState("loading");
      const { data, error } = await supabase.rpc("lookup_party_order", {
        p_order_ref: useRef ? cleanRef : "",
        p_contact: cleanContact,
      });

      if (error) {
        setLookupState("idle");
        toast({ title: "Lookup failed", description: error.message, variant: "destructive" });
        return;
      }

      const parsed = parseLookup(data);
      setLookup(parsed);
      setSelectedBandId(parsed ? parsed.matched_wallet_id ?? (parsed.bands.length === 1 ? parsed.bands[0].wallet_id : null) : null);
      setProof(useRef ? cleanRef : cleanContact);
      setLookupState(parsed ? "found" : "not_found");
    },
    [toast],
  );

  // Auto-run when arriving from the confirmation email link.
  useEffect(() => {
    if (refFromUrl.length >= 6) void runLookup(refFromUrl, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLookupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lookupState !== "loading") void runLookup(refInput, contactInput);
  };

  const resetLookup = () => {
    setLookup(null);
    setLookupState("idle");
    setPaid(null);
    setQuantities({});
  };

  const adjustQuantity = (packId: string, delta: number) => {
    setQuantities((current) => {
      const next = Math.min(MAX_PACK_QUANTITY, Math.max(0, (current[packId] || 0) + delta));
      const updated = { ...current };
      if (next === 0) delete updated[packId];
      else updated[packId] = next;
      return updated;
    });
  };

  const selection = useMemo(() => {
    const lines = packs.filter((pack) => (quantities[pack.id] || 0) > 0).map((pack) => ({ pack, quantity: quantities[pack.id] }));
    return {
      lines,
      totalInr: lines.reduce((sum, line) => sum + line.pack.inr_amount * line.quantity, 0),
      totalCoins: lines.reduce((sum, line) => sum + line.pack.coin_amount * line.quantity, 0),
    };
  }, [packs, quantities]);

  const handlePay = async () => {
    if (!lookup || selection.lines.length === 0 || isPaying) return;
    if (lookup.bands.length > 1 && !selectedBandId) {
      toast({ title: "Pick a band first", description: "Choose whose wristband these coins are for.", variant: "destructive" });
      return;
    }

    setIsPaying(true);
    setIsGatewayOpening(true);
    let activeProvider = provider;

    let paymentAbortController: AbortController | null = null;

    try {
      const checkoutToken = createCheckoutToken();
      const { data: order, error: orderError } = await supabase
        .rpc("create_coin_order_checkout", {
          p_parent_order_id: lookup.order_id,
          p_proof: proof,
          p_cart_items: selection.lines.map((line) => ({
            item_type: "coin_package",
            coin_package_id: line.pack.id,
            quantity: line.quantity,
          })),
          p_checkout_token_hash: await sha256Hex(checkoutToken),
          p_attribution: getLandingAttribution() as unknown as Json,
          p_target_wallet_id: selectedBandId,
        })
        .single();

      if (orderError) throw new Error(orderError.message);
      if (!order?.order_id) throw new Error("The coin order could not be created");

      paymentAbortControllerRef.current?.abort();
      paymentAbortController = new AbortController();
      paymentAbortControllerRef.current = paymentAbortController;
      const result = await runGatewayPayment({
        orderId: order.order_id,
        checkoutToken,
        signal: paymentAbortController.signal,
        fallbackCustomer: { name: lookup.first_name, email: "", phone: "" },
        description: "Pink'd Coins",
        onProviderKnown: (known) => {
          activeProvider = known;
          setProvider(known);
        },
        onGatewayVisible: () => setIsGatewayOpening(false),
      });

      const amountInr = Number(order.total_amount_inr) || selection.totalInr;

      if (result.isPaid) {
        const items: TrackingCartItem[] = selection.lines.map((line) => ({
          item_id: line.pack.id,
          item_name: `${line.pack.coin_amount} Pink'd Coins`,
          item_category: "coins",
          price: line.pack.inr_amount,
          quantity: line.quantity,
        }));
        trackPurchaseOnce({ orderId: order.order_id, value: amountInr, items, paymentProvider: result.provider });
      }

      setPaid({ orderId: order.order_id, coins: selection.totalCoins, amountInr, isPaid: result.isPaid, provider: result.provider });
      setQuantities({});
      void runLookup(refInput, contactInput); // refresh coins_purchased
    } catch (error) {
      toast({ title: "Payment not completed", description: getPaymentErrorMessage(error, activeProvider), variant: "destructive" });
    } finally {
      if (paymentAbortControllerRef.current === paymentAbortController) {
        paymentAbortControllerRef.current = null;
      }
      setIsGatewayOpening(false);
      setIsPaying(false);
    }
  };

  const isFound = lookupState === "found" && lookup !== null;
  const entryWord = lookup?.party_entries === 1 ? "entry" : "entries";

  return (
    <div className="min-h-screen bg-[#0b0a0d] text-white" style={{ fontFamily: 'Manrope, "Helvetica Neue", Arial, sans-serif' }}>
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-5 pb-16 pt-8 sm:pt-12">
        <header className="flex flex-col items-center gap-4 text-center">
          <Link to="/" aria-label="Pink'd home">
            <img src={LOGO_SRC} alt="Pink'd" className="h-12 w-auto" />
          </Link>
          <div>
            <Badge className="mb-3 bg-primary/15 text-primary hover:bg-primary/15">Ticket holders only</Badge>
            <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">Pink'd Coins</h1>
            <p className="mt-2 text-sm text-white/60">
              The party runs on Pink'd Coins. Buy them now, load them onto your wristband at the gate.
            </p>
          </div>
        </header>

        {/* Step 1: find the ticket */}
        {!isFound ? (
          <Card className={panelClass}>
            <CardContent className="p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2 text-lg font-bold">
                <Ticket className="h-5 w-5 text-primary" /> Find your ticket
              </div>
              <form onSubmit={handleLookupSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="coins-order-ref" className="text-white/80">Order reference</Label>
                  <Input
                    id="coins-order-ref"
                    value={refInput}
                    onChange={(event) => setRefInput(event.target.value.toUpperCase())}
                    placeholder="e.g. 1A2B3C4D"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={36}
                    className={`${inputClass} font-mono tracking-widest`}
                  />
                </div>
                <div className="text-center text-xs uppercase tracking-wider text-white/40">or</div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="coins-contact" className="text-white/80">Email or phone used at booking</Label>
                  <Input
                    id="coins-contact"
                    value={contactInput}
                    onChange={(event) => setContactInput(event.target.value)}
                    placeholder="you@example.com or 98765 43210"
                    autoComplete="email"
                    className={inputClass}
                  />
                </div>
                <Button type="submit" size="lg" disabled={lookupState === "loading"} className="h-12 rounded-xl text-base font-bold">
                  {lookupState === "loading" ? <Loader2 className="animate-spin" /> : <Search />}
                  {lookupState === "loading" ? "Looking up your ticket" : "Find my ticket"}
                </Button>
              </form>

              {lookupState === "not_found" ? (
                <div className="mt-5 rounded-xl border border-white/10 bg-black/40 p-4 text-sm">
                  <div className="font-bold">We couldn't find a paid party ticket for that.</div>
                  <p className="mt-1 text-white/60">
                    Check the order reference in your confirmation email, or try the email or phone you booked with.
                    Still stuck? The team can sort it out.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    <Button asChild variant="outline" className={`rounded-xl ${outlineButtonClass}`}>
                      <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">Message the team</a>
                    </Button>
                    <Button asChild variant="link" className="text-primary">
                      <Link to="/">Book a party ticket</Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Step 3: paid / pending */}
        {isFound && paid ? (
          <Card className={`text-white ${paid.isPaid ? "border-primary/40 bg-primary/10" : "border-amber-400/40 bg-amber-400/10"}`}>
            <CardContent className="flex gap-3 p-5 text-sm sm:p-6">
              {paid.isPaid ? (
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
              ) : (
                <Clock className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" />
              )}
              {paid.isPaid ? (
                <div>
                  <div className="text-base font-bold">
                    {formatCoinLabel(paid.coins)} are booked against order {lookup.order_ref}.
                  </div>
                  <p className="mt-1 text-white/70">
                    {lookup.wallet_linked
                      ? "They're on your band now. Your balance updates below in a few seconds."
                      : "Show this order reference at the gate and they'll be loaded onto your band."}
                  </p>
                </div>
              ) : (
                <div>
                  <div className="text-base font-bold">Payment pending</div>
                  <p className="mt-1 text-white/70">
                    {getGatewayLabel(paid.provider)} hasn't confirmed this payment yet. Check your email for the
                    confirmation, and if nothing arrives{" "}
                    <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="text-primary underline">message the team</a>.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Step 2: pick coin packs */}
        {isFound ? (
          <>
            <Card className={panelClass}>
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold">Hi {lookup.first_name}</div>
                    <div className="mt-1 text-sm text-white/60">
                      Order <span className="font-mono font-semibold text-white">{lookup.order_ref}</span> · {lookup.party_entries} party {entryWord}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={resetLookup} className="text-white/60 hover:bg-white/10 hover:text-white">
                    Not you?
                  </Button>
                </div>
                {lookup.bands.length > 1 ? (
                  <div className="mt-4 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm">
                    <div className="mb-2 font-semibold">Whose band are these coins for?</div>
                    <div className="grid gap-2">
                      {lookup.bands.map((band) => {
                        const active = selectedBandId === band.wallet_id;
                        return (
                          <button
                            type="button"
                            key={band.wallet_id}
                            onClick={() => setSelectedBandId(band.wallet_id)}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                              active ? "border-primary bg-primary/20" : "border-white/15 bg-black/30 hover:border-white/40"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <CheckCircle2 className={`h-4 w-4 shrink-0 ${active ? "text-primary" : "text-white/30"}`} />
                              {band.name}
                              {band.band_hint ? <span className="text-white/50">···{band.band_hint}</span> : null}
                            </span>
                            <span className="font-bold">{formatCoinLabel(band.coin_balance)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : lookup.wallet_linked ? (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      {lookup.bands[0]?.name ? `${lookup.bands[0].name}'s band` : "Band"}{lookup.band_hint ? ` ···${lookup.band_hint}` : ""} linked
                    </span>
                    <span className="font-bold">{formatCoinLabel(lookup.coin_balance)}</span>
                  </div>
                ) : lookup.coins_waiting > 0 ? (
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                    <span>{formatCoinLabel(lookup.coins_waiting)} already bought online, waiting to load at the gate.</span>
                  </div>
                ) : null}
                <p className="mt-4 text-sm leading-relaxed text-white/60">
                  Your ticket already covers entry, the welcome drink and the four free games: Beer Pong, Jamaal
                  Challenge, Red Flag Green Flag and Squid Games. Everything else on the night runs on Pink'd Coins.
                  {lookup.wallet_linked
                    ? "Whatever you buy here lands on your wristband within seconds — no queue, no tapping."
                    : "Whatever you buy here is loaded onto your wristband at the gate; after that, this link tops it up instantly."}
                </p>
              </CardContent>
            </Card>

            <section className="flex flex-col gap-3" aria-label="Coin packs">
              {packsLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/60">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" /> Loading coin packs
                </div>
              ) : packs.length === 0 ? (
                <div className={`rounded-xl border p-5 text-center text-sm text-white/60 ${panelClass}`}>
                  Coin packs aren't on sale right now. Check back soon.
                </div>
              ) : (
                packs.map((pack) => {
                  const quantity = quantities[pack.id] || 0;
                  const bonus = pack.coin_amount - pack.inr_amount;
                  return (
                    <div
                      key={pack.id}
                      className={`flex items-center justify-between gap-4 rounded-xl border p-4 transition-colors ${
                        quantity > 0 ? "border-primary/60 bg-primary/10" : "border-white/10 bg-white/[0.04]"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-base font-bold">{formatCoinLabel(pack.coin_amount)}</div>
                        <div className="mt-0.5 text-sm text-white/60">
                          {formatEventPrice(pack.inr_amount)}
                          {bonus > 0 ? <span className="ml-2 text-primary">+{bonus.toLocaleString("en-IN")} bonus</span> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Remove one ${pack.coin_amount} coin pack`}
                          disabled={quantity === 0 || isPaying}
                          onClick={() => adjustQuantity(pack.id, -1)}
                          className={stepperButtonClass}
                        >
                          <Minus />
                        </Button>
                        <span className="w-8 text-center text-lg font-bold tabular-nums" aria-live="polite">{quantity}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Add one ${pack.coin_amount} coin pack`}
                          disabled={quantity >= MAX_PACK_QUANTITY || isPaying}
                          onClick={() => adjustQuantity(pack.id, 1)}
                          className={stepperButtonClass}
                        >
                          <Plus />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </section>

            {packs.length > 0 ? (
              <Card className="sticky bottom-4 border-white/15 bg-[#151217] text-white shadow-2xl">
                <CardContent className="flex flex-col gap-4 p-5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-white/50">You'll receive</div>
                      <div className="text-xl font-extrabold">{formatCoinLabel(selection.totalCoins)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wider text-white/50">Total</div>
                      <div className="text-xl font-extrabold tabular-nums">{formatEventPrice(selection.totalInr)}</div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="lg"
                    disabled={selection.lines.length === 0 || isPaying || (lookup.bands.length > 1 && !selectedBandId)}
                    onClick={() => void handlePay()}
                    className="min-h-[52px] rounded-xl text-base font-bold"
                  >
                    {isPaying ? <Loader2 className="animate-spin" /> : null}
                    {isPaying ? "Processing" : `Pay ${formatEventPrice(selection.totalInr)}`}
                  </Button>
                  <p className="text-center text-xs text-white/50">
                    Secure payment via {getGatewayLabel(provider)} · UPI, cards and netbanking.
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}

        <footer className="mt-4 text-center text-xs text-white/40">
          Questions?{" "}
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="text-white/70 underline">Message the team on WhatsApp</a>
        </footer>
      </main>

      {isGatewayOpening ? (
        <div className="fixed inset-0 z-[2147483646] grid place-items-center bg-black text-white">
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            <div>
              <div className="text-lg font-bold">Opening secure checkout</div>
              <div className="mt-1 text-sm text-white/60">Please wait while {getGatewayLabel(provider)} loads.</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
