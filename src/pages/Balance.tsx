import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { nfcManager } from "@/utils/nfc";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { formatCoins, formatInr, getCoinAmount, getCoinBalance } from "@/lib/coins";
import { 
  CreditCard, 
  Scan, 
  CheckCircle, 
  History,
  Wallet,
  TrendingDown,
  TrendingUp,
  User
} from "lucide-react";

type WalletTransaction = Pick<
  Tables<"transactions">,
  "id" | "type" | "amount" | "inr_amount" | "coin_amount" | "description" | "created_at"
>;

type WalletWithTransactions = Tables<"wallets"> & {
  transactions: WalletTransaction[] | null;
};

interface DisplayTransaction {
  id: string;
  type: "Coin Purchase" | "Sale";
  amount: number;
  inrAmount: number | null;
  description: string;
  timestamp: string;
}

interface WalletBalanceView {
  attendeeName: string;
  attendeePhone: string;
  tagId: string;
  issuedDate: string;
  status: string;
  currentBalance: number;
  totalTopUp: number;
  totalSpent: number;
  transactions: DisplayTransaction[];
}

export default function Balance() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [walletData, setWalletData] = useState<WalletBalanceView | null>(null);

  const handleScanWallet = async () => {
    setIsScanning(true);
    
    try {
      const result = await nfcManager.startScanning();
      
      if (result.success) {
        // Fetch wallet data from Supabase based on tag ID
        const { data: wallet, error } = await supabase
          .from('wallets')
          .select(`
            *,
            transactions (
              id,
              type,
              amount,
              inr_amount,
              coin_amount,
              description,
              created_at
            )
          `)
          .eq('tag_id', result.tagId)
          .single();

        if (error || !wallet) {
          toast({
            title: "No Wallet Found",
            description: `NFC tag ${result.tagId} scanned but no wallet is linked to this tag. Please issue this tag first.`,
            variant: "destructive",
          });
          setWalletData(null);
          return;
        }

        const walletWithTransactions = wallet as WalletWithTransactions;
        const transactions = walletWithTransactions.transactions ?? [];

        // Calculate totals
        const totalTopUp = transactions
          .filter((transaction) => transaction.type === 'load' || transaction.type === 'coin_purchase')
          .reduce((sum, transaction) => sum + Math.max(0, getCoinAmount(transaction)), 0);
        
        const totalSpent = transactions
          .filter((transaction) => ['spend', 'games', 'drinks', 'food'].includes(transaction.type))
          .reduce((sum, transaction) => sum + Math.abs(getCoinAmount(transaction)), 0);

        // Format data for UI
        const formattedWallet = {
          attendeeName: wallet.attendee_name,
          attendeePhone: wallet.attendee_phone,
          tagId: wallet.tag_id,
          issuedDate: new Date(wallet.created_at).toLocaleDateString(),
          status: wallet.status,
          currentBalance: getCoinBalance(wallet),
          totalTopUp,
          totalSpent,
          transactions: transactions.map((transaction): DisplayTransaction => ({
            id: transaction.id,
            type: transaction.type === 'load' || transaction.type === 'coin_purchase' ? 'Coin Purchase' : 'Sale',
            amount: getCoinAmount(transaction),
            inrAmount: transaction.inr_amount,
            description: transaction.description,
            timestamp: new Date(transaction.created_at).toLocaleString()
          }))
        };

        setWalletData(formattedWallet);
        
        toast({
          title: "Wallet Found",
          description: `Successfully loaded wallet for ${wallet.attendee_name}`,
        });
      } else {
        toast({
          title: "Scanning Failed",
          description: result.error || "Could not scan NFC tag. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Scanning Failed",
        description: "Could not scan NFC tag. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Check Pink'd Coins</h1>
        <p className="text-muted-foreground mt-2">View NFC wallet coin balance and transaction history</p>
      </div>

      {/* Scanner Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <span>Scan Wallet</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <Button
            onClick={handleScanWallet}
            disabled={isScanning}
            size="lg"
            className="bg-gradient-primary hover:shadow-hover transition-smooth"
          >
            {isScanning ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                <span>Scanning...</span>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <Scan className="w-5 h-5" />
                <span>Scan NFC Tag</span>
              </div>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Wallet Information */}
      {walletData && (
        <>
          {/* Wallet Overview */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <User className="w-5 h-5 text-primary" />
                <span>Wallet Information</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Customer Info */}
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <CheckCircle className="w-6 h-6 text-success" />
                    <div>
                      <div className="text-lg font-semibold text-foreground">{walletData.attendeeName}</div>
                      <div className="text-sm text-muted-foreground">{walletData.attendeePhone}</div>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tag ID:</span>
                      <Badge variant="outline">{walletData.tagId}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Issued:</span>
                      <span className="text-foreground">{walletData.issuedDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge variant="default" className="bg-success text-success-foreground">
                        {walletData.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                {/* Balance Info */}
                <div className="bg-gradient-card p-6 rounded-lg border">
                  <div className="text-center space-y-4">
                    <Wallet className="w-12 h-12 text-primary mx-auto" />
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">Current Pink'd Coin Balance</div>
                      <div className="text-4xl font-bold text-primary">
                        {formatCoins(walletData.currentBalance)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="shadow-card">
              <CardContent className="pt-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-success/10 rounded-lg">
                    <TrendingUp className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Coins Credited</div>
                    <div className="text-xl font-bold text-foreground">
                      {formatCoins(walletData.totalTopUp)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardContent className="pt-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-destructive/10 rounded-lg">
                    <TrendingDown className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Coins Spent</div>
                    <div className="text-xl font-bold text-foreground">
                      {formatCoins(walletData.totalSpent)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardContent className="pt-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-accent/10 rounded-lg">
                    <History className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Transactions</div>
                    <div className="text-xl font-bold text-foreground">
                      {walletData.transactions.length}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Transaction History */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <History className="w-5 h-5 text-primary" />
                <span>Recent Transactions</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {walletData.transactions.map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-lg ${
                        transaction.type === "Sale" 
                          ? "bg-destructive/10" 
                          : "bg-success/10"
                      }`}>
                        {transaction.type === "Sale" ? (
                          <TrendingDown className="w-4 h-4 text-destructive" />
                        ) : (
                          <TrendingUp className="w-4 h-4 text-success" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{transaction.description}</div>
                        <div className="text-sm text-muted-foreground">{transaction.timestamp}</div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className={`font-bold ${
                        transaction.amount > 0 ? "text-success" : "text-destructive"
                      }`}>
                        {transaction.amount > 0 ? "+" : ""}{formatCoins(Math.abs(transaction.amount))}
                      </div>
                      {transaction.inrAmount && (
                        <div className="text-xs text-muted-foreground">
                          Paid {formatInr(transaction.inrAmount)}
                        </div>
                      )}
                      <Badge 
                        variant={transaction.type === "Sale" ? "destructive" : "default"}
                        className="text-xs"
                      >
                        {transaction.type}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
