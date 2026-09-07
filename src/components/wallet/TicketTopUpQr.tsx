import { useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { COINS_URL, isLinkedTicket, ticketReference, ticketTopUpUrl } from "@/lib/ticketTopUp";
import genericQr from "@/assets/coins-qr.png?inline";

type QrState = { walletId: string; url?: string; image?: string; error?: string };

export function TicketTopUpQr({ walletId }: { walletId?: string | null }) {
  const { toast } = useToast();
  const [state, setState] = useState<QrState | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!walletId) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    setState(null);
    const load = async () => {
      let url: string | undefined;
      try {
        const { data: wallet, error } = await supabase.from("wallets")
          .select("id,event_order_id,status").eq("id", walletId).abortSignal(controller.signal).single();
        if (error) throw new Error("Could not check this band's ticket. Retry or use the counter.");
        if (!wallet || wallet.status !== "active") throw new Error("This band is inactive or blocked. Ask an admin for help.");
        const ref = ticketReference(wallet.event_order_id);
        if (!ref) throw new Error("This band is not linked to a ticket. Link it at the counter before buying online.");
        const lookup = await supabase.rpc("lookup_party_order", { p_order_ref: ref, p_contact: "" }).abortSignal(controller.signal);
        if (lookup.error) throw new Error("Could not check this ticket. Retry or use the counter.");
        if (!isLinkedTicket(lookup.data, wallet.event_order_id!, walletId)) {
          throw new Error("No eligible paid party ticket is linked to this band. Ask the counter for help.");
        }
        url = ticketTopUpUrl(wallet.event_order_id!, walletId);
        const { toDataURL } = await import("qrcode");
        const image = await toDataURL(url, { width: 256, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
        if (!cancelled) setState({ walletId, url, image });
      } catch (e) {
        if (!cancelled) setState({ walletId, url, error: url ? "QR unavailable. Open or copy the ticket link below." : e instanceof Error ? e.message : "Ticket link unavailable. Retry or use the counter." });
      } finally { window.clearTimeout(timeout); }
    };
    void load();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [walletId, attempt]);

  const current = state?.walletId === walletId ? state : null;
  const url = walletId ? current?.url : COINS_URL;
  const image = walletId ? current?.image : genericQr;
  return <section aria-label="Online coin top-up" className="space-y-3 border-y border-border py-5">
    <h2 className="font-semibold">{walletId ? "Top up on your phone" : "Buy coins online"}</h2>
    <p className="text-sm text-muted-foreground">{walletId ? "Scan with your phone camera, confirm your band, then choose a pack and pay by UPI or card." : "Scan with your phone camera and look up your ticket to buy a coin pack."}</p>
    {walletId && !current && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Checking ticket...</p>}
    {image && <img src={image} alt={walletId ? "Scan to top up this ticket's band" : "Scan to open Pink'd Coins"} width={256} height={256} className="mx-auto aspect-square h-auto w-64 max-w-full bg-white" />}
    {current?.error && <p role="status" className="text-sm text-muted-foreground">{current.error}</p>}
    {url && <div className="flex flex-wrap justify-center gap-2">
      <Button type="button" variant="outline" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Open coin shop</a></Button>
      <Button type="button" variant="outline" onClick={async () => {
        try { await navigator.clipboard.writeText(url); toast({ title: "Coin shop link copied" }); }
        catch { toast({ title: "Could not copy link", description: "Use Open coin shop instead.", variant: "destructive" }); }
      }}><Copy className="mr-2 h-4 w-4" />Copy link</Button>
    </div>}
    {current?.error && <Button type="button" variant="outline" onClick={() => setAttempt(n => n + 1)}><RefreshCw className="mr-2 h-4 w-4" />Retry ticket link</Button>}
    {url && <p className="text-center text-xs text-muted-foreground">Coins are credited only after payment confirmation. Do not also credit that online payment at the counter.</p>}
  </section>;
}
