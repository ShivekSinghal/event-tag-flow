import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getFunctionErrorMessage } from "@/lib/checkoutGateway";
import { formatEventPrice } from "@/lib/eventPackages";
import { Banknote, CheckCircle, Mail, RefreshCw, RotateCcw, XCircle } from "lucide-react";

/**
 * Cash desk (studio managers + admins).
 * The student booked on their own phone with "Pay cash at the studio" (the booking page opened
 * with ?counter=1). Their order shows up here for 45 minutes. Take the cash → Send code (emailed
 * to the student) → type the code they read out → Paid. Expired holds can be revived.
 */

type Row = {
  order_id: string; order_ref: string; customer_name: string; customer_phone_hint: string; customer_email: string;
  customer_studio: string | null; total_amount_inr: number; payment_status: string; items: string | null;
  hold_expires_at: string | null; hold_live: boolean; code_sent: boolean; confirmed_at: string | null;
  requested_by: string | null; created_at: string;
};

const STUDIOS = [
  "Noida Sector 43 (NDA)", "Noida Sector 50 (RMG)", "Pitampura (PP)", "Rajouri Garden (RG)", "Preet Vihar (ED)",
  "Anand Vihar (AV)", "Gurgaon (GGN)", "Indirapuram (IPM)", "South Delhi (SD)", "Dwarka (DWK)", "Not a Student",
];

function secondsLeft(iso: string | null) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

export default function CashBooking() {
  const { toast } = useToast();
  const { isAdmin, isStudioManager } = useAuth();
  const [studio, setStudio] = useState<string>(() => { try { return localStorage.getItem("pinkd_cash_desk_studio") || ""; } catch { return ""; } });
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_cash_desk_orders", { p_studio: studio || null });
    if (!error) setRows(((data as unknown) as Row[]) || []);
  }, [studio]);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), 8000);
    const tick = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [load]);

  useEffect(() => { try { localStorage.setItem("pinkd_cash_desk_studio", studio); } catch { /* ignore */ } }, [studio]);

  const invoke = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("cash-booking", { body });
    if (error) throw new Error(await getFunctionErrorMessage(error, data));
    if (data && typeof data === "object" && "error" in data && data.error) throw new Error(String(data.error));
    return data as Record<string, unknown>;
  };

  const sendCode = async (r: Row) => {
    setBusy(r.order_id);
    try {
      const d = await invoke({ action: "request_code", order_id: r.order_id });
      setActive(r.order_id);
      setCode("");
      toast({ title: "Code emailed", description: `Sent to ${d.sent_to}. Ask ${r.customer_name.split(" ")[0]} to check email (and spam) and read it out.` });
      void load();
    } catch (e) {
      toast({ title: "Couldn't send the code", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const confirm = async (r: Row) => {
    setBusy(r.order_id);
    try {
      const d = await invoke({ action: "confirm", order_id: r.order_id, code });
      toast({ title: `Paid · ${d.order_ref}`, description: `${r.customer_name} is booked. Confirmation email on its way.` });
      setActive(null); setCode("");
      void load();
    } catch (e) {
      toast({ title: "Not confirmed", description: e instanceof Error ? e.message : "Try again", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const revive = async (r: Row) => {
    setBusy(r.order_id);
    try {
      const { data, error } = await supabase.rpc("revive_cash_order", { p_order_id: r.order_id });
      if (error) throw error;
      const d = (data || {}) as { revived?: boolean; reason?: string };
      if (!d.revived) throw new Error(d.reason === "already_paid" ? "Already paid" : "Could not revive");
      toast({ title: "Hold revived", description: "5 more minutes — take the cash and send the code." });
      void load();
    } catch (e) {
      toast({ title: "Couldn't revive", description: e instanceof Error ? e.message : "Ask the student to book again", variant: "destructive" });
    } finally { setBusy(null); }
  };

  const cancel = async (r: Row) => {
    if (!window.confirm(`Cancel ${r.customer_name}'s cash booking ${r.order_ref}? They can book again.`)) return;
    setBusy(r.order_id);
    try { await invoke({ action: "cancel", order_id: r.order_id }); if (active === r.order_id) setActive(null); void load(); }
    catch (e) { toast({ title: "Couldn't cancel", description: e instanceof Error ? e.message : "", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  if (!isAdmin && !isStudioManager) {
    return <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">The cash desk is for studio managers and admins.</div>;
  }

  const pending = rows.filter((r) => !r.confirmed_at && !["paid", "completed"].includes(r.payment_status));
  const done = rows.filter((r) => r.confirmed_at || ["paid", "completed"].includes(r.payment_status));

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Cash desk</h1>
        <p className="text-muted-foreground mt-2">
          Students book on their own phone at <span className="font-mono text-foreground">pinkd.hashtag.dance/?counter=1</span> and choose
          “Cash at the studio”. Their order appears here. Take the cash → Send code → type the code they read out.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="cd-studio" className="text-sm text-muted-foreground">Studio</label>
        <select id="cd-studio" value={studio} onChange={(e) => setStudio(e.target.value)} className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm">
          <option value="">All studios</option>
          {STUDIOS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="outline" size="icon" aria-label="Refresh" onClick={() => void load()}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      <Card className="shadow-card">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center space-x-2 text-base"><Banknote className="w-5 h-5 text-primary" /><span>Waiting at the counter ({pending.length})</span></CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.length === 0 && <p className="text-sm text-muted-foreground">No one yet. This list refreshes on its own.</p>}
          {pending.map((r) => {
            const left = secondsLeft(r.hold_expires_at);
            const live = r.hold_live && left > 0;
            const isActive = active === r.order_id;
            return (
              <div key={r.order_id} className={`rounded-lg border p-3 ${isActive ? "border-primary bg-primary/5" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.customer_name} <span className="font-mono text-xs text-muted-foreground">{r.customer_phone_hint}</span></div>
                    <div className="text-xs text-muted-foreground truncate">{r.items} · {r.customer_studio}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">{r.order_ref}</Badge>
                      {live ? (
                        <span className={`text-xs ${left < 60 ? "text-warning" : "text-muted-foreground"}`}>hold {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>
                      ) : (
                        <span className="text-xs text-destructive">hold expired</span>
                      )}
                      {r.code_sent && !isActive && <span className="text-xs text-muted-foreground">· code sent by {r.requested_by}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xl font-black">{formatEventPrice(Number(r.total_amount_inr))}</div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">cash</div>
                  </div>
                </div>

                {isActive ? (
                  <div className="mt-3 space-y-2">
                    <Input
                      inputMode="numeric"
                      autoFocus
                      maxLength={6}
                      placeholder="6-digit code from the student's email"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) void confirm(r); }}
                      className="h-14 text-center text-2xl font-black tracking-[0.4em]"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Button className="col-span-2 h-11 font-bold" disabled={busy === r.order_id || code.length !== 6} onClick={() => void confirm(r)}>
                        <CheckCircle className="w-4 h-4 mr-2" />{busy === r.order_id ? "Confirming…" : "Confirm paid"}
                      </Button>
                      <Button variant="outline" className="h-11" disabled={busy === r.order_id} onClick={() => void sendCode(r)}>
                        <Mail className="w-4 h-4 mr-1" />Resend
                      </Button>
                    </div>
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => { setActive(null); setCode(""); }}>Back</Button>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {live ? (
                      <Button className="col-span-2 h-11 font-bold" disabled={busy === r.order_id} onClick={() => void sendCode(r)}>
                        <Mail className="w-4 h-4 mr-2" />{busy === r.order_id ? "Sending…" : r.code_sent ? "Enter code / resend" : `Cash received · send code`}
                      </Button>
                    ) : (
                      <Button className="col-span-2 h-11 font-bold" variant="secondary" disabled={busy === r.order_id} onClick={() => void revive(r)}>
                        <RotateCcw className="w-4 h-4 mr-2" />{busy === r.order_id ? "Reviving…" : "Revive hold (5 min)"}
                      </Button>
                    )}
                    <Button variant="ghost" className="h-11 text-muted-foreground" disabled={busy === r.order_id} onClick={() => void cancel(r)}>
                      <XCircle className="w-4 h-4 mr-1" />Cancel
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {done.length > 0 && (
        <Card className="shadow-card">
          <CardHeader className="pb-3"><CardTitle className="text-base">Paid in the last 45 minutes ({done.length})</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {done.map((r) => (
              <div key={r.order_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.customer_name} <span className="font-mono text-xs text-muted-foreground">{r.order_ref}</span></div>
                  <div className="text-xs text-muted-foreground truncate">{r.items} · by {r.requested_by || "—"} · {r.confirmed_at ? new Date(r.confirmed_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold">{formatEventPrice(Number(r.total_amount_inr))}</div>
                  <Badge className="text-xs">Paid · cash</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
