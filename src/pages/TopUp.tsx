import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { nfcManager } from "@/utils/nfc";
import { supabase } from "@/integrations/supabase/client";
import { useFlyingCards } from "@/hooks/use-flying-cards";
import { formatCoins, formatInr, getCoinBalance } from "@/lib/coins";
import { 
  Wallet, 
  Scan, 
  DollarSign, 
  CheckCircle, 
  AlertCircle,
  Plus,
  CreditCard
} from "lucide-react";

interface CoinPackage {
  id: string;
  inr_amount: number;
  coin_amount: number;
  active: boolean;
  display_order: number;
}

export default function TopUp() {
  const { toast } = useToast();
  const { addCard } = useFlyingCards();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedWallet, setScannedWallet] = useState<any>(null);
  const [coinPackages, setCoinPackages] = useState<CoinPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    fetchCoinPackages();
  }, []);

  const fetchCoinPackages = async () => {
    const { data, error } = await supabase
      .from("coin_packages")
      .select("*")
      .eq("active", true)
      .order("display_order", { ascending: true });

    if (error) {
      toast({
        title: "Packages Unavailable",
        description: "Could not load Pink'D Coin packages. Please try again.",
        variant: "destructive",
      });
      return;
    }

    setCoinPackages((data || []) as CoinPackage[]);
  };

  const handleScanWallet = async () => {
    setIsScanning(true);
    
    try {
      const result = await nfcManager.startScanning();
      
      if (result.success) {
        // Fetch wallet data from Supabase based on tag ID
        const { data: wallet, error } = await supabase
          .from('wallets')
          .select('*')
          .eq('tag_id', result.tagId)
          .single();

        if (error || !wallet) {
          toast({
            title: "No Wallet Found",
            description: `NFC tag ${result.tagId} scanned but no wallet is linked to this tag. Please issue this tag first.`,
            variant: "destructive",
          });
          setScannedWallet(null);
          return;
        }

        // Format wallet data for UI
        const formattedWallet = {
          id: wallet.id,
          attendeeName: wallet.attendee_name,
          attendeePhone: wallet.attendee_phone,
          tagId: wallet.tag_id,
          currentBalance: getCoinBalance(wallet),
          status: wallet.status
        };

        setScannedWallet(formattedWallet);
        
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

  const handleTopUp = async () => {
    const selectedPackage = coinPackages.find((pkg) => pkg.id === selectedPackageId);

    if (!scannedWallet || !selectedPackage) {
      toast({
        title: "Select Package",
        description: "Please select a Pink'D Coin package.",
        variant: "destructive",
      });
      return;
    }

    if (!paymentReference.trim()) {
      toast({
        title: "Payment Reference Required",
        description: "Confirm payment success by entering the payment reference before crediting coins.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      const inrAmount = Number(selectedPackage.inr_amount);
      const coinAmount = Number(selectedPackage.coin_amount);
      const { data: topUpResult, error: topUpError } = await supabase
        .rpc("credit_wallet_coins", {
          p_wallet_id: scannedWallet.id,
          p_coin_package_id: selectedPackage.id,
          p_payment_reference: paymentReference.trim(),
        })
        .single();

      if (topUpError) {
        throw topUpError;
      }

      const newBalance = Number(topUpResult.new_coin_balance);
      
      toast({
        title: "Pink'D Coins Credited",
        description: `${formatCoins(coinAmount)} added after ${formatInr(inrAmount)} payment. New balance: ${formatCoins(newBalance)}.`,
      });

      // Show flying card animation
      addCard({
        amount: coinAmount,
        name: scannedWallet.attendeeName,
        studio: "Staff Terminal", // You can get this from user context if needed
        type: "topup"
      });

      // Update local state
      setScannedWallet({
        ...scannedWallet,
        currentBalance: newBalance
      });
      setSelectedPackageId("");
      setPaymentReference("");
    } catch (error) {
      toast({
        title: "Top-Up Failed",
        description: "There was an error processing the top-up. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Pink'D Coin Top-Up</h1>
        <p className="text-muted-foreground mt-2">Sell coin packages and credit an attendee's NFC wallet</p>
      </div>

      {/* Wallet Scanner Card */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <CreditCard className="w-5 h-5 text-primary" />
            <span>Scan Wallet</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Scan Button */}
          <div className="text-center">
            <Button
              onClick={handleScanWallet}
              disabled={isScanning}
              size="lg"
              className="w-full max-w-xs bg-gradient-primary hover:shadow-hover transition-smooth"
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
          </div>

          {/* Wallet Display */}
          {scannedWallet && (
            <div className="bg-success/10 border border-success/20 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <CheckCircle className="w-6 h-6 text-success" />
                  <div>
                    <div className="font-medium text-foreground">{scannedWallet.attendeeName}</div>
                    <div className="text-sm text-muted-foreground">{scannedWallet.attendeePhone}</div>
                  </div>
                </div>
                <Badge variant="outline" className="border-success text-success">
                  {scannedWallet.tagId}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between pt-3 border-t border-success/20">
                <span className="text-sm font-medium text-muted-foreground">Current Pink'D Coin Balance</span>
                <div className="flex items-center space-x-2">
                  <Wallet className="w-4 h-4 text-success" />
                  <span className="text-lg font-bold text-success">
                    {formatCoins(scannedWallet.currentBalance)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top-Up Amount Card */}
      {scannedWallet && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Plus className="w-5 h-5 text-primary" />
              <span>Select Coin Package</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {coinPackages.map((pkg) => (
                <Button
                  key={pkg.id}
                  type="button"
                  variant={selectedPackageId === pkg.id ? "default" : "outline"}
                  onClick={() => setSelectedPackageId(pkg.id)}
                  className="h-auto justify-between p-4 text-left"
                >
                  <span>{formatInr(pkg.inr_amount)}</span>
                  <span className="font-bold">{formatCoins(pkg.coin_amount)}</span>
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment-reference" className="flex items-center space-x-2">
                <DollarSign className="w-4 h-4" />
                <span>Confirmed Payment Reference</span>
              </Label>
              <Input
                id="payment-reference"
                placeholder="UPI/Razorpay/cash receipt reference"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                className="transition-smooth focus:shadow-hover"
              />
            </div>

            {/* Top-Up Button */}
            <Button
              onClick={handleTopUp}
              disabled={!selectedPackageId || !paymentReference.trim() || isProcessing}
              size="lg"
              className="w-full bg-gradient-primary hover:shadow-hover transition-smooth"
            >
              {isProcessing ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                  <span>Processing...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Plus className="w-5 h-5" />
                  <span>
                    Credit {selectedPackageId
                      ? formatCoins(coinPackages.find((pkg) => pkg.id === selectedPackageId)?.coin_amount || 0)
                      : "Pink'D Coins"}
                  </span>
                </div>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="shadow-card bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-2">Coin Top-Up Process:</p>
              <ul className="space-y-1">
                <li>• Scan the attendee's NFC band using its default UID</li>
                <li>• Select the package and collect the listed INR payment</li>
                <li>• Enter the confirmed payment reference before crediting coins</li>
                <li>• The transaction logs INR paid and Pink'D Coins credited</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
