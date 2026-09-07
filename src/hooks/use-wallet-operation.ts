import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  clearWalletOperation, parseWalletOperationResult, readWalletOperation, saveWalletOperation,
  type PendingWalletOperation, type WalletOperationRequest, type WalletOperationResult,
} from "@/lib/walletOperation";

const inFlight = new Set<string>();
// Keep a response visible if its original screen unmounts while the request runs.
const completedResults = new Map<string, WalletOperationResult>();
const changedEvent = "pinkd-wallet-operation-changed";

export function useWalletOperation() {
  const { user } = useAuth();
  const operator = user?.id;
  const operatorRef = useRef(operator);
  operatorRef.current = operator;
  const [pending, setPending] = useState<PendingWalletOperation | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WalletOperationResult | null>(null);
  const [loadedOperator, setLoadedOperator] = useState<string | undefined>();

  const refresh = useCallback(() => {
    try {
      setPending(operator ? readWalletOperation(sessionStorage, operator) : null);
      setStorageError(null);
    } catch (e) {
      setStorageError(e instanceof Error ? e.message : "Payment storage is unavailable.");
    }
    setBusy(Boolean(operator && inFlight.has(operator)));
    setResult(operator ? completedResults.get(operator) || null : null);
    setLoadedOperator(operator);
  }, [operator]);

  useEffect(() => {
    setResult(null);
    setError(null);
    refresh();
    window.addEventListener(changedEvent, refresh);
    return () => window.removeEventListener(changedEvent, refresh);
  }, [refresh]);

  const submit = useCallback(async (request?: WalletOperationRequest): Promise<WalletOperationResult | null> => {
    if (!operator || inFlight.has(operator)) return null;
    inFlight.add(operator);
    completedResults.delete(operator);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let operation = readWalletOperation(sessionStorage, operator);
      if (operation && request) throw new Error("Resolve the saved payment before starting another.");
      if (!operation) {
        if (!request) throw new Error("No saved payment to retry.");
        operation = { version: 1, id: crypto.randomUUID(), operator, request };
        // Do not send a mutation unless its retry identity has been persisted first.
        saveWalletOperation(sessionStorage, operation);
      }
      setPending(operation);
      window.dispatchEvent(new Event(changedEvent));
      const { data, error: rpcError } = await supabase.rpc("execute_wallet_operation", {
        p_operation_id: operation.id,
        p_request: operation.request,
      }).abortSignal(AbortSignal.timeout(20_000));
      if (rpcError) throw rpcError;
      const outcome = parseWalletOperationResult(data);
      clearWalletOperation(sessionStorage, operation);
      completedResults.set(operator, outcome);
      if (operatorRef.current === operator) {
        setPending(null);
        setResult(outcome);
      }
      return outcome;
    } catch (e) {
      if (operatorRef.current === operator) {
        setError(e instanceof Error ? e.message : "The server response could not be confirmed.");
      }
      return null;
    } finally {
      inFlight.delete(operator);
      if (operatorRef.current === operator) refresh();
      window.dispatchEvent(new Event(changedEvent));
    }
  }, [operator, refresh]);

  return {
    pending: loadedOperator === operator ? pending : null,
    busy, error: loadedOperator === operator ? storageError || error : null,
    result: loadedOperator === operator ? result : null, submit,
    blocked: !operator || loadedOperator !== operator || Boolean(pending || storageError || busy),
  };
}
