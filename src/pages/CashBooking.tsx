import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatEventPrice } from "@/lib/eventPackages";
import CashStudioAssignments from "@/components/admin/CashStudioAssignments";
import { RefreshCw, Mail, CheckCircle, RotateCcw, XCircle } from "lucide-react";

type Row = {
  order_id: string; order_ref: string; customer_name: string; customer_phone_hint: string; customer_email: string;
  customer_studio: string; cash_studio: string; total_amount_inr: number; payment_status: string; items: string;
  hold_expires_at: string; code_sent: boolean; confirmed_at: string | null; cancelled_at: string | null;
  requested_by: string | null; created_at: string; notifications: { kind: string; status: string; error: string | null }[];
};
type Action = "request_code" | "confirm" | "revive" | "cancel" | "retry_notifications";
type Operation = { order_id: string; operation_id: string; action: Action };
type Result = { status?: string; confirmed?: boolean; error?: string; notifications?: { status: string }[] };
function readPending(key: string): Operation | null {
  const value = JSON.parse(sessionStorage.getItem(key) || "null") as Operation | null;
  if (value && (!value.operation_id || !value.order_id || !["request_code", "confirm", "revive", "cancel", "retry_notifications"].includes(value.action))) throw new Error("Invalid pending cash action");
  return value;
}

export default function CashBooking() {
  const { user, isAdmin, isStudioManager } = useAuth();
  if (!user || (!isAdmin && !isStudioManager)) return <p className="p-8">Cash Desk is for admins and assigned studio managers.</p>;
  return <Desk key={user.id} userId={user.id} admin={isAdmin} />;
}

function Desk({ userId, admin }: { userId: string; admin: boolean }) {
  const key = `pinkd.cash.desk.v1.${userId}`;
  const [pending, setPending] = useState<Operation | null>(() => {
    try { return readPending(key); } catch { return null; }
  });
  const [storageBlocked] = useState(() => { try { readPending(key); return false; } catch { return true; } });
  const [studio, setStudio] = useState("");
  const [view, setView] = useState<"holds" | "paid">("holds");
  const [rows, setRows] = useState<Row[]>([]);
  const [studios, setStudios] = useState<string[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const guard = useRef(false);

  useEffect(() => {
    let active = true;
    let fetching = false;
    setLoading(true); setRows([]);
    const load = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const result = await supabase.rpc("list_cash_desk_orders", { p_studio: studio || null }).abortSignal(AbortSignal.timeout(12_000));
        const assigned = admin ? await supabase.from("cash_studios").select("name").abortSignal(AbortSignal.timeout(12_000)) : await supabase.from("cash_manager_studios").select("studio").eq("user_id", userId).abortSignal(AbortSignal.timeout(12_000));
        if (!active) return;
        if (result.error || assigned.error) throw new Error("Cash Desk could not refresh. Do not collect cash until the hold is checked.");
        setRows((result.data || []) as unknown as Row[]);
        setStudios((assigned.data || []).map(s => "name" in s ? s.name : s.studio)); setError("");
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Cash Desk unavailable"); }
      finally { fetching = false; if (active) setLoading(false); }
    };
    void load();
    const poll = window.setInterval(() => void load(), 8000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; window.clearInterval(poll); window.clearInterval(tick); };
  }, [studio, userId, admin]);

  const invoke = useCallback(async (body: Operation & { code?: string } | (Omit<Operation, "action"> & { action: "check_operation" })) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = supabase.functions.invoke("cash-booking", { body });
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Cash action timed out")), 25_000); });
    const { data, error: failure } = await Promise.race([response, timeout]).finally(() => clearTimeout(timer));
    if (failure) throw new Error("Cash action status unknown");
    if (!data || typeof data !== "object") throw new Error("Cash action status unknown");
    return data as Result;
  }, []);

  const run = async (row: Row | null, action?: Action) => {
    if (guard.current) return;
    guard.current = true; setBusy(true); setNotice("");
    try {
      let operation = readPending(key) || pending;
      if (!operation) {
        if (!row || !action) return;
        if (action === "cancel" && !window.confirm(`Cancel cash booking ${row.order_ref}?`)) return;
        operation = { order_id: row.order_id, action, operation_id: crypto.randomUUID() };
        // Persist before the first network request. Never persist the student's OTP.
        sessionStorage.setItem(key, JSON.stringify(operation)); setPending(operation);
      }
      let result: Result | null = null;
      if (pending && operation.action !== "retry_notifications") {
        const saved = await invoke({ ...operation, action: "check_operation" });
        if (saved.status !== "not_recorded") result = saved;
      }
      if (!result) {
        const code = codes[operation.order_id] || "";
        if (operation.action === "confirm" && code.length !== 6) { setNotice("Enter the original six-digit code, then Check / Retry safely."); return; }
        result = await invoke({ ...operation, ...(operation.action === "confirm" ? { code } : {}) });
      }
      if (!["succeeded", "rejected"].includes(result.status || "")) throw new Error("Cash action status unknown");
      sessionStorage.removeItem(key); setPending(null);
      setCodes(c => ({ ...c, [operation.order_id]: "" }));
      setNotice(result.status === "rejected" ? result.error || "Action rejected" : result.confirmed ? "Cash payment recorded. Do not collect again." : "Cash action recorded. Check the refreshed hold and email status below.");
      if (result.notifications?.some(n => n.status === "error")) setNotice(n => `${n} Email delivery needs retry; payment remains recorded.`);
      const refreshed = await supabase.rpc("list_cash_desk_orders", { p_studio: studio || null });
      if (!refreshed.error) setRows((refreshed.data || []) as unknown as Row[]);
    } catch { setNotice("Payment status unknown. Check / Retry safely using the same operation before collecting cash again."); }
    finally { guard.current = false; setBusy(false); }
  };

  const visible = rows.filter(r => view === "paid" ? Boolean(r.confirmed_at) : !r.confirmed_at);
  return <div className="mx-auto max-w-5xl space-y-5">
    <h1 className="text-2xl font-bold">Cash Desk</h1>
    <div className="flex flex-wrap items-center gap-3">
      <label className="w-full min-w-0 sm:w-auto sm:flex-1">Collecting studio<select className="mt-1 h-10 w-full border bg-background px-2" value={studio} onChange={e => setStudio(e.target.value)}><option value="">All assigned studios</option>{studios.map(s => <option key={s}>{s}</option>)}</select></label>
      <div role="tablist" className="flex gap-2">{(["holds", "paid"] as const).map(v => <Button role="tab" aria-selected={view === v} variant={view === v ? "default" : "outline"} key={v} onClick={() => setView(v)}>{v === "holds" ? "Holds" : "Cash reconciliation"}</Button>)}</div>
    </div>
    {loading && <p role="status">Loading Cash Desk...</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!loading && !studios.length && !admin && <p>No cash studio assigned. Ask an admin to assign your studio.</p>}
    {notice && <p role="status">{notice}</p>}
    {storageBlocked && <p role="alert">Stored cash action needs support review. Do not collect cash again.</p>}
    {pending && <div role="alert" className="space-y-2 border border-primary p-3"><p>Unresolved {pending.action.replace(/_/g, " ")} · {pending.order_id.slice(0, 8).toUpperCase()}</p>
      {pending.action === "confirm" && <Input aria-label="Original confirmation code" inputMode="numeric" value={codes[pending.order_id] || ""} maxLength={6} onChange={e => setCodes({ ...codes, [pending.order_id]: e.target.value.replace(/\D/g, "") })} />}
      <Button disabled={busy} onClick={() => void run(null)}><RefreshCw className="mr-2 h-4 w-4" />Check / Retry safely</Button></div>}
    {!loading && !visible.length && <p className="text-muted-foreground">No {view === "paid" ? "confirmed cash bookings" : "recent cash holds"}.</p>}
    {view === "paid" && <p className="font-semibold">Shown cash receipts: {visible.length} · {formatEventPrice(visible.reduce((s, r) => s + Number(r.total_amount_inr), 0))}</p>}
    <div className="divide-y">{visible.map(r => {
      const left = Math.max(0, Math.ceil((Date.parse(r.hold_expires_at) - now) / 1000));
      const locked = busy || storageBlocked || Boolean(pending) || Boolean(error);
      return <section key={r.order_id} className="space-y-3 py-4">
        <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{r.customer_name} · {r.order_ref}</h2><p className="text-sm text-muted-foreground">{r.cash_studio} · {r.customer_phone_hint}</p><p className="text-sm">{r.items}</p><p className="text-xs text-muted-foreground">Home studio: {r.customer_studio}</p></div><strong>{formatEventPrice(Number(r.total_amount_inr))}</strong></div>
        {r.confirmed_at ? <p>Paid · {new Date(r.confirmed_at).toLocaleString("en-IN")} · {r.requested_by}</p> : r.cancelled_at ? <p>Cancelled</p> : <>
          <p>{left ? `Hold ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Hold expired. Do not collect cash until revived."}</p>
          {left > 0 && <Input aria-label={`Code for ${r.order_ref}`} placeholder="Six-digit email code" inputMode="numeric" maxLength={6} value={codes[r.order_id] || ""} disabled={locked} onChange={e => setCodes({ ...codes, [r.order_id]: e.target.value.replace(/\D/g, "") })} />}
          <div className="flex flex-wrap gap-2">
            {left > 0 ? <><Button disabled={locked} onClick={() => void run(r, "request_code")}><Mail className="mr-2 h-4 w-4" />{r.code_sent ? "Resend code" : "Send code"}</Button><Button disabled={locked || (codes[r.order_id]?.length !== 6)} onClick={() => void run(r, "confirm")}><CheckCircle className="mr-2 h-4 w-4" />Confirm cash received</Button></> : <Button disabled={locked} onClick={() => void run(r, "revive")}><RotateCcw className="mr-2 h-4 w-4" />Revive hold</Button>}
            <Button variant="outline" disabled={locked} onClick={() => void run(r, "cancel")}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>
          </div>
        </>}
        {!!r.notifications?.length && <p className="text-xs text-muted-foreground">{r.notifications.map(n => `${n.kind}: ${n.status}${n.error ? ` (${n.error})` : ""}`).join(" · ")}</p>}
        {r.notifications?.some(n => ["error", "pending", "sending"].includes(n.status)) && <Button variant="outline" disabled={locked} onClick={() => void run(r, "retry_notifications")}><Mail className="mr-2 h-4 w-4" />Retry notifications</Button>}
      </section>;
    })}</div>
    {admin && <CashStudioAssignments />}
  </div>;
}
