import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { nfcManager } from "@/utils/nfc";
import { supabase } from "@/integrations/supabase/client";
import { 
  Wallet, 
  Scan, 
  DollarSign, 
  CheckCircle, 
  AlertCircle,
  Plus,
  CreditCard
} from "lucide-react";

const quickAmounts = [100, 250, 500, 1000];

export default function TopUp() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedWallet, setScannedWallet] = useState<any>(null);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

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
          currentBalance: typeof wallet.balance === 'string' ? parseFloat(wallet.balance) : wallet.balance,
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

  const handleQuickAmount = (amount: number) => {
    setTopUpAmount(amount.toString());
  };

  const handleTopUp = async () => {
    if (!scannedWallet || !topUpAmount || parseFloat(topUpAmount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid top-up amount.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      const amount = parseFloat(topUpAmount);
      const newBalance = scannedWallet.currentBalance + amount;
      
      // Update wallet balance in Supabase
      const { error: updateError } = await supabase
        .from('wallets')
        .update({ balance: newBalance })
        .eq('id', scannedWallet.id);

      if (updateError) {
        throw updateError;
      }

      // Add transaction record
      const { error: transactionError } = await supabase
        .from('transactions')
        .insert({
          wallet_id: scannedWallet.id,
          type: 'load',
          amount: amount,
          description: `Top-up at staff terminal`,
          reference: `TOPUP_${Date.now()}`
        });

      if (transactionError) {
        throw transactionError;
      }
      
      toast({
        title: "Top-Up Successful",
        description: `Added ₹${amount.toFixed(2)} to wallet. New balance: ₹${newBalance.toFixed(2)}`,
      });

      // Update local state
      setScannedWallet({
        ...scannedWallet,
        currentBalance: newBalance
      });
      setTopUpAmount("");
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
        <h1 className="text-3xl font-bold text-foreground">Wallet Top-Up</h1>
        <p className="text-muted-foreground mt-2">Add funds to an attendee's digital wallet</p>
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
                <span className="text-sm font-medium text-muted-foreground">Current Balance</span>
                <div className="flex items-center space-x-2">
                  <Wallet className="w-4 h-4 text-success" />
                  <span className="text-lg font-bold text-success">
                    ₹{scannedWallet.currentBalance.toFixed(2)}
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
              <span>Add Funds</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quick Amount Buttons */}
            <div>
              <Label className="text-sm font-medium text-muted-foreground mb-3 block">
                Quick Amounts
              </Label>
              <div className="grid grid-cols-4 gap-3">
                {quickAmounts.map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    onClick={() => handleQuickAmount(amount)}
                    className="hover:bg-primary hover:text-primary-foreground transition-smooth"
                  >
                    ₹{amount}
                  </Button>
                ))}
              </div>
            </div>

            {/* Custom Amount Input */}
            <div className="space-y-2">
              <Label htmlFor="amount" className="flex items-center space-x-2">
                <DollarSign className="w-4 h-4" />
                <span>Custom Amount</span>
              </Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="Enter amount"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                className="transition-smooth focus:shadow-hover"
              />
            </div>

            {/* Top-Up Button */}
            <Button
              onClick={handleTopUp}
              disabled={!topUpAmount || parseFloat(topUpAmount) <= 0 || isProcessing}
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
                  <span>Add ₹{topUpAmount ? parseFloat(topUpAmount).toFixed(2) : "0.00"}</span>
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
              <p className="font-medium text-foreground mb-2">Manual Top-Up Process:</p>
              <ul className="space-y-1">
                <li>• Collect cash payment from attendee before processing</li>
                <li>• Verify the payment amount matches the top-up amount</li>
                <li>• Scan the attendee's NFC tag to load their wallet</li>
                <li>• Transaction will be logged for reconciliation</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}