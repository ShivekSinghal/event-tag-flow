import { AlertCircle, CheckCircle, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { useWalletOperation } from "@/hooks/use-wallet-operation";
import { InsufficientCoinsNotice } from "./InsufficientCoinsNotice";

export function WalletOperationStatus({ operation, showSpendReceipt = true }: { operation: ReturnType<typeof useWalletOperation>; showSpendReceipt?: boolean }) {
  const { pending, busy, error, result } = operation;
  if (!pending && !error && !result) return null;
  if (!showSpendReceipt && !pending && !error && result?.status === "succeeded" && operation.lastSale?.transactionId === result.transaction_id) return null;
  return (
    <><section role="status" aria-live="polite" className="space-y-3 rounded-md border border-primary/40 bg-secondary p-4">
      {pending ? <>
        <h2 className="flex items-center gap-2 font-bold"><AlertCircle className="h-5 w-5" />
          {pending.request.kind === "void" ? (busy ? "Confirming sale void" : "Void status unknown") : (busy ? "Confirming payment" : "Payment status unknown")}
        </h2>
        <p className="break-words text-sm">{pending.request.kind === "spend" ? pending.request.item_name : pending.request.kind === "void" ? "POS coin refund" : "Coin top-up"} · Operation <span className="break-all">{pending.id}</span></p>
        <p className="text-sm">Do not charge or credit again. Check this saved operation before starting another.</p>
        <Button type="button" disabled={busy} onClick={() => void operation.submit()}>
          <RefreshCw className={`mr-2 h-4 w-4 ${busy ? "animate-spin" : ""}`} />Check / Retry safely
        </Button>
        <p className="text-sm"><Link className="underline" to="/dashboard">Ask an admin to check transactions</Link></p>
      </> : result ? <>
        <h2 className="flex items-center gap-2 font-bold">{result.status === "succeeded" ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
          {result.status === "succeeded" ? (result.voided_transaction_id ? "Sale voided" : "Payment confirmed") : "Operation not processed"}
        </h2>
        {result.status === "succeeded" ? <>
          <p className="break-all text-sm">Transaction {result.transaction_id}</p>
          {result.voided_transaction_id && <p className="text-sm">{result.credited_coin_amount?.toLocaleString("en-IN")} Pink'd Coins refunded.</p>}
          <p className="text-sm">Balance after transaction: {result.new_coin_balance?.toLocaleString("en-IN")} Pink'd Coins</p>
        </> : <p className="text-sm">{result.message}</p>}
      </> : <h2 className="font-bold">Payment unavailable</h2>}
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
    </section>
    {result?.status === "rejected" && /insufficient/i.test(result.message || "") && <InsufficientCoinsNotice />}</>
  );
}
