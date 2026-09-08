import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

const KEY = "pinkd.cash.checkout.v1";
const CHANGED = "pinkd-cash-checkout-changed";
export type CashReceipt = { order_id: string; total_amount_inr: number; payment_status?: string; hold_expires_at: string; cash_studio?: string; email_sent?: boolean };
type Attempt = { operationId: string; tokenHash: string; request?: Json; receipt?: CashReceipt };
function load(): Attempt | null {
  const saved = sessionStorage.getItem(KEY);
  if (!saved) return null;
  const value = JSON.parse(saved) as Attempt;
  if (!value.operationId || !value.tokenHash || (!value.request && !value.receipt)) throw new Error("Stored cash checkout needs support review");
  return value;
}

export function useCashCheckout() {
  const [storageBlocked] = useState(() => { try { load(); return false; } catch { return true; } });
  const [record, setRecord] = useState<Attempt | null>(() => { try { return load(); } catch { return null; } });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const current = useRef(record);
  const persist = useCallback((next: Attempt | null) => {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
    else sessionStorage.removeItem(KEY);
    current.current = next;
    setRecord(next);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  useEffect(() => {
    const refresh = () => {
      try { const value = load(); current.current = value; setRecord(value); }
      catch { setError("Stored cash checkout needs support review"); }
    };
    window.addEventListener(CHANGED, refresh);
    return () => window.removeEventListener(CHANGED, refresh);
  }, []);

  const submit = useCallback(async (request?: Json) => {
    if (guard.current) return null;
    guard.current = true;
    setBusy(true);
    setError("");
    let attempted = false;
    try {
      // Re-read storage: never silently overwrite a malformed/unresolved identity.
      const saved = load();
      let attempt = saved?.request ? saved : null;
      if (!attempt) {
        if (!request) throw new Error("No pending cash checkout");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(crypto.randomUUID() + crypto.randomUUID()));
        attempt = { operationId: crypto.randomUUID(), tokenHash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join(""), request };
        persist(attempt);
      }
      attempted = true;
      const { data, error: rpcError } = await supabase.rpc("create_cash_event_order_checkout", {
        p_operation_id: attempt.operationId, p_checkout_token_hash: attempt.tokenHash, p_request: attempt.request!,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (rpcError) {
        // A PostgreSQL rejection rolls back the whole transaction. Transport failures do not prove that.
        if (["P0001", "42501", "22023", "23514"].includes(rpcError.code)) {
          persist(null);
          attempted = false;
        }
        throw new Error(rpcError.message);
      }
      const receipt = data as unknown as CashReceipt;
      if (!receipt?.order_id || !receipt.hold_expires_at) throw new Error("Invalid cash receipt response");
      persist({ operationId: attempt.operationId, tokenHash: attempt.tokenHash, receipt });
      return receipt;
    } catch (e) {
      setError(attempted ? "Booking status unknown. Check / Retry safely before starting another payment." : e instanceof Error ? e.message : "Cash checkout unavailable");
      return null;
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }, [persist]);

  useEffect(() => {
    if (!record?.receipt) return;
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { data, error: failure } = await supabase.rpc("cash_checkout_status", { p_order_id: record.receipt!.order_id, p_checkout_token_hash: record.tokenHash }).abortSignal(AbortSignal.timeout(10_000));
        if (!active || current.current?.operationId !== record.operationId) return;
        if (failure || !data) { setError("Cash status unavailable. Ask the manager to check this reference before collecting payment."); return; }
        const receipt = data as unknown as CashReceipt;
        if (JSON.stringify(receipt) !== JSON.stringify(current.current.receipt)) persist({ ...record, receipt });
        setError("");
      } catch { if (active) setError("Cash status unavailable. Keep this reference."); }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => { active = false; window.clearInterval(timer); };
  }, [record, persist]);

  return { receipt: record?.receipt, pending: Boolean(record?.request) || storageBlocked, busy, error: storageBlocked ? "Stored cash checkout cannot be recovered automatically. Contact support before starting another payment." : error, submit };
}
