import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, MessageCircle, Save, Search, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// --- RPC shapes (mirrors supabase/migrations/20260904120000_event_order_attendees.sql) ---

type SlotItem = { package_name: string; quantity: number; pax: number | null };
type SavedAttendee = { position: number; attendee_name: string; attendee_phone: string };
type AttendeeSlots = {
  order_id: string;
  order_ref: string;
  booker_name: string;
  booker_phone: string;
  party_entries: number;
  requires_form: boolean;
  items: SlotItem[];
  attendees: SavedAttendee[];
};
type Row = { name: string; phone: string };
type RpcResult = { data: unknown; error: { message: string } | null };

// Cast so this compiles before the generated types pick up the new RPCs
// (see TYPES_ADDITIONS_attendees.md).
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<RpcResult>;

const WHATSAPP_URL = "https://wa.me/919205488417?text=Hi%2C%20I%20need%20help%20adding%20attendee%20names%20for%20Pink%27d";
const PAGE_TITLE = "Pink'd · Attendee names";

const digitsIn = (value: string) => value.replace(/\D/g, "").length;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

function buildRows(slots: AttendeeSlots): Row[] {
  const saved = new Map(slots.attendees.map((a) => [a.position, a]));
  return Array.from({ length: slots.party_entries }, (_, i) => {
    const position = i + 1;
    const hit = saved.get(position);
    if (hit) return { name: hit.attendee_name, phone: hit.attendee_phone };
    if (position === 1 && slots.attendees.length === 0) {
      return { name: slots.booker_name, phone: slots.booker_phone };
    }
    return { name: "", phone: "" };
  });
}

const inputClass = "bg-black/40 border-white/15 text-white placeholder:text-white/40 focus-visible:ring-primary";

const AttendeesPage = () => {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const refFromUrl = (searchParams.get("ref") ?? "").trim().toUpperCase();

  const [orderRef, setOrderRef] = useState(refFromUrl);
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState<"idle" | "looking" | "notfound" | "found">("idle");
  const [slots, setSlots] = useState<AttendeeSlots | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastSavedCount, setLastSavedCount] = useState<number | null>(null);
  const autoLookupDone = useRef(false);

  // noindex + title while mounted; restore on unmount.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = PAGE_TITLE;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.title = previousTitle;
      meta.remove();
    };
  }, []);

  const lookup = useCallback(
    async (ref: string, contactValue: string) => {
      const cleanRef = ref.trim();
      const cleanContact = contactValue.trim();
      if (cleanRef.length < 6 && cleanContact.length < 5) {
        toast({
          title: "Tell us which booking",
          description: "Enter your order reference, or the email / phone you booked with.",
          variant: "destructive",
        });
        return;
      }
      setStatus("looking");
      setLastSavedCount(null);
      const { data, error } = await rpc("lookup_order_attendee_slots", {
        p_order_ref: cleanRef,
        p_contact: cleanContact,
      });
      if (error) {
        setStatus("idle");
        toast({ title: "Could not look up your booking", description: error.message, variant: "destructive" });
        return;
      }
      if (!data) {
        setSlots(null);
        setStatus("notfound");
        return;
      }
      const found = data as AttendeeSlots;
      setSlots(found);
      setRows(buildRows(found));
      setStatus("found");
    },
    [toast],
  );

  // Landing from the confirmation email: ?ref=XXXXXXXX is enough to look up.
  useEffect(() => {
    if (autoLookupDone.current || refFromUrl.length < 6) return;
    autoLookupDone.current = true;
    void lookup(refFromUrl, "");
  }, [refFromUrl, lookup]);

  const handleLookup = (event: FormEvent) => {
    event.preventDefault();
    void lookup(orderRef, contact);
  };

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!slots) return;

    const filled: { position: number; attendee_name: string; attendee_phone: string }[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const name = rows[i].name.trim();
      const phone = rows[i].phone.trim();
      if (!name && !phone) continue;
      if (!name || !phone) {
        toast({
          title: `Wristband ${i + 1} is incomplete`,
          description: "Each filled row needs both a name and a phone number.",
          variant: "destructive",
        });
        return;
      }
      if (digitsIn(phone) < 10) {
        toast({
          title: `Check the phone for wristband ${i + 1}`,
          description: "Phone numbers need at least 10 digits.",
          variant: "destructive",
        });
        return;
      }
      filled.push({ position: i + 1, attendee_name: name, attendee_phone: phone });
    }

    if (filled.length === 0) {
      toast({ title: "Nothing to save yet", description: "Add at least one name and phone.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { data, error } = await rpc("submit_order_attendees", {
      p_order_ref: orderRef.trim() || slots.order_ref,
      p_contact: contact.trim(),
      p_attendees: filled,
    });
    setSaving(false);

    if (error || !data) {
      toast({
        title: "Could not save names",
        description: error?.message ?? "Please try again in a moment.",
        variant: "destructive",
      });
      return;
    }

    const updated = data as AttendeeSlots;
    setSlots(updated);
    setRows(buildRows(updated));
    setLastSavedCount(updated.attendees.length);
    toast({
      title: "Names saved",
      description: `${updated.attendees.length} of ${updated.party_entries} wristbands named.`,
    });
  };

  const isBusy = status === "looking" || saving;

  return (
    <div className="min-h-screen bg-[#0b0a0d] text-white">
      <main className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-8 sm:py-12">
        <header className="flex flex-col items-center gap-4 text-center">
          <Link to="/" aria-label="Pink'd home">
            <img src="/media/pinkd-logo.png" alt="Pink'd" className="h-12 w-auto sm:h-14" />
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Attendee names</h1>
            <p className="mt-1 text-sm text-white/70">
              One name per wristband. Add them any time before the party on 11 Sep.
            </p>
          </div>
        </header>

        {/* Step 1 · find the booking */}
        <Card className="border-white/10 bg-white/[0.04] text-white">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5 text-primary" aria-hidden="true" />
              Find your booking
            </CardTitle>
            <CardDescription className="text-white/60">
              Your order reference is in the confirmation email. Either field is enough.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLookup} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="order-ref" className="text-white/80">Order reference</Label>
                  <Input
                    id="order-ref"
                    value={orderRef}
                    onChange={(e) => setOrderRef(e.target.value.toUpperCase())}
                    placeholder="e.g. 3F9A2C1B"
                    autoComplete="off"
                    autoCapitalize="characters"
                    maxLength={36}
                    className={`${inputClass} font-mono tracking-wider`}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="contact" className="text-white/80">Email or phone used at booking</Label>
                  <Input
                    id="contact"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    placeholder="you@example.com or 98765 43210"
                    autoComplete="email"
                    className={inputClass}
                  />
                </div>
              </div>
              <Button type="submit" disabled={isBusy} className="w-full sm:w-auto sm:self-end">
                {status === "looking" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Find my booking
              </Button>
            </form>
          </CardContent>
        </Card>

        {status === "notfound" && (
          <Card className="border-white/10 bg-white/[0.04] text-white">
            <CardContent className="flex flex-col gap-3 pt-6 text-sm text-white/80">
              <p className="text-base font-medium text-white">We couldn't find a paid party ticket for that.</p>
              <p>
                Double-check the reference in your confirmation email, or try the email or phone you used at
                checkout. If you paid a few minutes ago, give it a moment and try again.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild variant="outline" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                  <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                    WhatsApp the team
                  </a>
                </Button>
                <Button asChild variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white">
                  <Link to="/">Back to Pink'd</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2 · the names */}
        {status === "found" && slots && (
          <Card className="border-primary/30 bg-white/[0.04] text-white">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Users className="h-5 w-5 text-primary" aria-hidden="true" />
                Who's coming, {firstName(slots.booker_name)}?
              </CardTitle>
              <CardDescription className="text-white/60">
                Order <span className="font-mono text-white">{slots.order_ref}</span> · {slots.party_entries}{" "}
                {slots.party_entries === 1 ? "wristband" : "wristbands"}
              </CardDescription>
              {slots.items.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2 text-xs text-white/60">
                  {slots.items.map((item, i) => (
                    <li key={`${item.package_name}-${i}`} className="rounded-full border border-white/10 px-2.5 py-1">
                      {item.quantity} × {item.package_name}
                    </li>
                  ))}
                </ul>
              )}
            </CardHeader>
            <CardContent>
              {!slots.requires_form ? (
                <p className="text-sm text-white/80">
                  Your booking is for one person — nothing to add. See you on the 11th.
                </p>
              ) : (
                <form onSubmit={handleSave} className="flex flex-col gap-5">
                  {lastSavedCount !== null && (
                    <div
                      role="status"
                      className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>
                        Saved {lastSavedCount} of {slots.party_entries} names. You can come back to this link to add
                        the rest.
                      </span>
                    </div>
                  )}

                  <ol className="flex flex-col gap-4">
                    {rows.map((row, index) => (
                      <li key={index} className="rounded-lg border border-white/10 bg-black/30 p-3 sm:p-4">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-primary">
                          Wristband {index + 1}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`name-${index}`} className="text-white/80">Name</Label>
                            <Input
                              id={`name-${index}`}
                              value={row.name}
                              onChange={(e) => updateRow(index, { name: e.target.value })}
                              placeholder="Full name"
                              autoComplete="off"
                              maxLength={120}
                              className={inputClass}
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <Label htmlFor={`phone-${index}`} className="text-white/80">Phone</Label>
                            <Input
                              id={`phone-${index}`}
                              type="tel"
                              inputMode="tel"
                              value={row.phone}
                              onChange={(e) => updateRow(index, { phone: e.target.value })}
                              placeholder="98765 43210"
                              autoComplete="off"
                              maxLength={40}
                              className={inputClass}
                            />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <p className="text-xs leading-relaxed text-white/60">
                    One name per wristband. Everyone at the party must be 18+ with ID at the gate. Tickets are
                    non-refundable and non-transferable.
                  </p>

                  <Button type="submit" disabled={isBusy} className="w-full">
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                    )}
                    Save names
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        <footer className="text-center text-xs text-white/40">
          Questions?{" "}
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-white/70 underline-offset-2 hover:underline">
            WhatsApp the Pink'd team
          </a>
        </footer>
      </main>
    </div>
  );
};

export default AttendeesPage;
