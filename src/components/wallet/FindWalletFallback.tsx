import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * "Can't scan? Find by phone" — staff fallback for Top Up, POS Sale and Check Coins.
 *
 * Calls public.staff_find_wallet(p_query): admins, studio managers, and staff with an
 * assigned POS permission may search active bands. It never returns full phones or tag IDs.
 *
 * Usage (directly under the Scan NFC Tag button):
 *   <FindWalletFallback onSelect={(w) => handleScannedWallet(w.wallet_id, { viaLookup: true })} />
 *
 * The confirm sheet is mandatory even for a single match, so a wrong pick can never touch
 * someone else's band. When you write the transaction afterwards, include "via:phone-lookup"
 * in its reference so the close-of-night report shows how often scanning failed.
 */

export type FoundWallet = {
  wallet_id: string;
  attendee_name: string;
  band_hint: string;
  coin_balance: number;
  studio: string | null;
  match_kind: "band_phone" | "booking_phone" | "order_ref" | "name";
};

type Props = {
  onSelect: (wallet: FoundWallet) => void;
  /** Called as soon as manual lookup takes over from an in-progress scanner. */
  onLookupStart?: () => boolean | void;
  /** Optional: hide the trigger link and always show the panel (e.g. on Check Coins). */
  alwaysOpen?: boolean;
  disabled?: boolean;
  className?: string;
};

const MATCH_LABEL: Record<FoundWallet["match_kind"], string> = {
  band_phone: "band phone",
  booking_phone: "booking phone",
  order_ref: "order ref",
  name: "name",
};

export const LOOKUP_REFERENCE_TAG = "via:phone-lookup";

export function FindWalletFallback({
  onSelect,
  onLookupStart,
  alwaysOpen = false,
  disabled = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(alwaysOpen);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<FoundWallet[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<FoundWallet | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced lookup: one RPC per keystroke burst, 3+ characters.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setRows([]);
      setStatus("idle");
      setError(null);
      return;
    }
    const mySeq = ++seq.current;
    setStatus("loading");
    const t = window.setTimeout(async () => {
      const { data, error: rpcError } = await supabase.rpc("staff_find_wallet", { p_query: q });
      if (mySeq !== seq.current) return; // a newer query is in flight
      if (rpcError) {
        setError(rpcError.message);
        setRows([]);
        setStatus("error");
        return;
      }
      setError(null);
      setRows((data as FoundWallet[]) || []);
      setStatus("done");
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const reset = () => {
    setQuery("");
    setRows([]);
    setStatus("idle");
    setError(null);
    setCandidate(null);
  };

  const confirm = () => {
    if (!candidate) return;
    const picked = candidate;
    reset();
    if (!alwaysOpen) setOpen(false);
    onSelect(picked);
  };

  const firstIsDigit = /^\d/.test(query.trim());

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (onLookupStart?.() === false) return;
          setOpen(true);
        }}
        className={`mt-2 w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        Can't scan? Find by phone or name
      </button>
    );
  }

  return (
    <div className={`mt-3 rounded-xl border border-border bg-muted/30 p-3 ${className}`}>
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Input
          ref={inputRef}
          disabled={disabled}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Phone, name or order ref"
          inputMode={firstIsDigit ? "numeric" : "text"}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 text-base"
        />
        {!alwaysOpen && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close lookup"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {status === "loading" && <p className="mt-2 text-xs text-muted-foreground">Searching…</p>}
      {status === "error" && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {status === "done" && rows.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          No active band for that. Check the number, or issue a band at the gate.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-background">
          {rows.map((w) => (
            <li key={w.wallet_id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setCandidate(w)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{w.attendee_name}</span>
                  <span className="block text-xs text-muted-foreground">
                    band ···{w.band_hint} · {w.studio || "—"} · matched by {MATCH_LABEL[w.match_kind]}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums">
                  {w.coin_balance.toLocaleString("en-IN")} coins
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Mandatory confirm sheet — even for a single match. */}
      <Dialog open={Boolean(candidate)} onOpenChange={(o) => !o && setCandidate(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogDescription className="text-xs uppercase tracking-wider">Use this band?</DialogDescription>
            <DialogTitle className="text-2xl font-extrabold leading-tight">{candidate?.attendee_name}</DialogTitle>
          </DialogHeader>
          {candidate && (
            <>
              <p className="text-sm text-muted-foreground">
                band ···{candidate.band_hint} · {candidate.studio || "—"}
              </p>
              <p className="text-3xl font-black tabular-nums">
                {candidate.coin_balance.toLocaleString("en-IN")}{" "}
                <span className="text-base font-semibold">coins</span>
              </p>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <Button type="button" variant="outline" className="h-12" onClick={() => setCandidate(null)}>
                  Not them
                </Button>
                <Button type="button" disabled={disabled} className="h-12 font-bold" onClick={confirm}>
                  Use this band
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FindWalletFallback;
