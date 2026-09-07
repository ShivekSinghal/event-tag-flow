import { useRef, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatCoins } from "@/lib/coins";
import type { useWalletOperation } from "@/hooks/use-wallet-operation";

type Sale = { id: string; wallet_id: string; item_name: string | null; coin_amount: number };

export function PosSaleControls({ operation, saleInProgress = false }: { operation: ReturnType<typeof useWalletOperation>; saleInProgress?: boolean }) {
  const { isAdmin } = useAuth();
  const [transactionId, setTransactionId] = useState("");
  const [candidate, setCandidate] = useState<Sale | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const searchingRef = useRef(false);
  const last = operation.lastSale;
  const disabled = operation.blocked || saleInProgress;

  const findSale = async (id: string) => {
    if (!isAdmin || disabled || searchingRef.current) return;
    setError("");
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id.trim())) {
      setError("Enter the complete sale transaction ID."); return;
    }
    searchingRef.current = true; setSearching(true);
    try {
      const { data, error: queryError } = await supabase.from("transactions")
        .select("id,wallet_id,item_name,coin_amount,type,reference")
        .eq("id", id.trim()).maybeSingle();
      if (queryError) throw queryError;
      if (!data || !["games", "food", "drinks"].includes(data.type) || data.coin_amount >= 0) throw new Error("No ordinary POS sale found for that ID.");
      if (data.reference?.startsWith("ROUND_")) throw new Error("Round entries cannot be voided.");
      setReason(""); setCandidate(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load this sale. Try again."); }
    finally { searchingRef.current = false; setSearching(false); }
  };

  const confirmVoid = async () => {
    if (!isAdmin || !candidate || disabled || reason.trim().length < 3) return;
    const sale = candidate;
    setCandidate(null);
    await operation.submit({ kind: "void", wallet_id: sale.wallet_id,
      sale_transaction_id: sale.id, void_reason: reason.trim(), reference: `VOID_${sale.id}` });
  };

  return <>
    {last && <section aria-label="Last sale" className="space-y-2 rounded-md border border-border bg-card p-4">
      <h2 className="font-semibold">Last sale{last.refundTransactionId ? " (voided)" : ""}</h2>
      <p className="break-words">{last.itemName} · {formatCoins(last.coinAmount)}</p>
      <p className="text-sm">Balance after sale: {formatCoins(last.balanceAfter)}</p>
      <p className="text-xs text-muted-foreground">Historical receipt, not the current wallet balance.</p>
      <p className="break-all text-xs">Transaction {last.transactionId}</p>
      {last.refundTransactionId && <p className="break-all text-xs">Refund {last.refundTransactionId}</p>}
      {isAdmin && !last.refundTransactionId && <Button variant="outline" disabled={disabled || searching} onClick={() => void findSale(last.transactionId)}>
        <RotateCcw className="mr-2 h-4 w-4" />Void last sale
      </Button>}
    </section>}
    {isAdmin && <section className="space-y-3 border-t border-border py-4" aria-label="Admin sale controls">
      <h2 className="font-semibold">Admin sale controls</h2>
      {saleInProgress && <p className="text-sm text-muted-foreground">Finish or cancel the current sale or round before voiding a sale.</p>}
      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void findSale(transactionId); }}>
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <Label htmlFor="void-sale-id">Sale transaction ID</Label>
          <Input id="void-sale-id" value={transactionId} onChange={e => setTransactionId(e.target.value)} disabled={disabled || searching} />
        </div>
        <Button type="submit" variant="outline" disabled={disabled || searching}><Search className="mr-2 h-4 w-4" />Find sale</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>}
    <Dialog open={isAdmin && Boolean(candidate)} onOpenChange={open => { if (!open) setCandidate(null); }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-lg bg-card">
        <DialogHeader><DialogTitle>Void this sale?</DialogTitle><DialogDescription>The original sale stays in the ledger. One coin refund is recorded; no INR payment is refunded.</DialogDescription></DialogHeader>
        <p className="break-words">{candidate?.item_name || "POS item"} · {formatCoins(-(candidate?.coin_amount || 0))}</p>
        <p className="break-all text-xs">{candidate?.id}</p>
        <Label htmlFor="void-reason">Reason for void</Label>
        <Input id="void-reason" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setCandidate(null)}>Cancel</Button>
          <Button variant="destructive" disabled={disabled || reason.trim().length < 3} onClick={() => void confirmVoid()}><RotateCcw className="mr-2 h-4 w-4" />Confirm coin refund</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
