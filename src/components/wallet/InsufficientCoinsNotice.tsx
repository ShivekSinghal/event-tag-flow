import { Link } from "react-router-dom";
import { AlertCircle, Wallet } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { formatCoins } from "@/lib/coins";
import { TicketTopUpQr } from "./TicketTopUpQr";

export function InsufficientCoinsNotice({ balance, required, walletId }: { balance?: number; required?: number; walletId?: string }) {
  const { isAdmin, isStudioManager } = useAuth();
  return <><section role="alert" className="space-y-2 rounded-md border border-destructive/50 bg-secondary p-4">
    <h2 className="flex items-center gap-2 font-semibold"><AlertCircle className="h-5 w-5 shrink-0" />Insufficient Pink'd Coins</h2>
    {balance !== undefined && required !== undefined && <p className="text-sm">
      Available: {formatCoins(balance)}. Required: {formatCoins(required)}. Add at least {formatCoins(Math.max(0, required - balance))}.
    </p>}
    <p className="text-sm">No coins were deducted. Buy coins using the link below or visit the top-up desk, then scan the band again.</p>
    {(isAdmin || isStudioManager) && <Button asChild variant="outline"><Link to="/topup"><Wallet className="mr-2 h-4 w-4" />Open Top Up</Link></Button>}
  </section><TicketTopUpQr walletId={walletId} /></>;
}
