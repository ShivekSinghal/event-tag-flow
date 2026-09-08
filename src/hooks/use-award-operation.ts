import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type Request = { wallet_id: string; game_id: string; entry_transaction_id: string };
type Operation = { id: string; operator: string; request: Request };
export type AwardResult = { status: "succeeded" | "rejected"; message?: string; award_id?: string; entry_transaction_id?: string; first_name?: string; game?: string; pinkredibles?: number; code?: string };
const inFlight = new Set<string>();
const changed = "pinkd-award-operation-changed";
const key = (operator: string) => `pinkd.award.operation.v1.${operator}`;
function read(operator: string): Operation | null {
  const raw = sessionStorage.getItem(key(operator));
  if (!raw) return null;
  const value = JSON.parse(raw) as Operation;
  if (!value.id || value.operator !== operator || !value.request?.wallet_id || !value.request.game_id || !value.request.entry_transaction_id) throw new Error("Saved award needs support review");
  return value;
}

export function useAwardOperation() {
  const { user } = useAuth();
  const operator = user?.id;
  const operatorRef = useRef(operator);
  operatorRef.current = operator;
  const [pending, setPending] = useState<Operation | null>(null);
  const [receipt, setReceipt] = useState<AwardResult | null>(null);
  const [loaded, setLoaded] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const refresh = useCallback(() => {
    setPending(null); setReceipt(null); setStorageError("");
    if (operator) {
      try {
        setPending(read(operator));
        setReceipt(JSON.parse(sessionStorage.getItem(`${key(operator)}.receipt`) || "null"));
      } catch { setStorageError("Award storage is unavailable. Resolve it before making a sale or award."); }
    }
    setBusy(Boolean(operator && inFlight.has(operator)));
    setLoaded(operator);
  }, [operator]);
  useEffect(() => {
    setError(""); refresh();
    window.addEventListener(changed, refresh);
    return () => window.removeEventListener(changed, refresh);
  }, [refresh]);
  const submit = useCallback(async (request?: Request) => {
    if (!operator || inFlight.has(operator)) return null;
    inFlight.add(operator); setBusy(true); setError("");
    try {
      let operation = read(operator);
      if (operation && request) throw new Error("Resolve the pending award first");
      if (!operation) {
        if (!request) throw new Error("No pending award");
        operation = { id: crypto.randomUUID(), operator, request };
        sessionStorage.setItem(key(operator), JSON.stringify(operation));
      }
      setPending(operation);
      window.dispatchEvent(new Event(changed));
      const { data, error: failure } = await supabase.rpc("award_pinkredible", { p_operation_id: operation.id, p_request: operation.request }).abortSignal(AbortSignal.timeout(20_000));
      if (failure) throw failure;
      const result = data as AwardResult;
      if (!["succeeded", "rejected"].includes(result?.status) || (result.status === "succeeded" && (!result.award_id || result.entry_transaction_id !== operation.request.entry_transaction_id))) throw new Error("Award response cannot be verified");
      if (result.status === "succeeded") sessionStorage.setItem(`${key(operator)}.receipt`, JSON.stringify(result));
      sessionStorage.removeItem(key(operator));
      if (operatorRef.current === operator) { setPending(null); if (result.status === "succeeded") setReceipt(result); else setError(result.message || "Award rejected"); }
      return result;
    } catch {
      if (operatorRef.current === operator) setError("Award status unknown. Check / Retry safely before another sale, award or void.");
      return null;
    } finally { inFlight.delete(operator); window.dispatchEvent(new Event(changed)); }
  }, [operator]);
  return { pending: loaded === operator ? pending : null, receipt: loaded === operator ? receipt : null, busy, error: storageError || error, submit, blocked: !operator || loaded !== operator || busy || Boolean(pending || storageError) };
}
