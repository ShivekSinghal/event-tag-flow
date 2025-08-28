import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { nfcManager } from "@/utils/nfc";
import { 
  ShoppingCart, 
  Scan, 
  CheckCircle, 
  AlertCircle,
  Minus,
  DollarSign,
  Package
} from "lucide-react";

const menuItems = [
  { id: 1, name: "Limbo Game", price: 50, category: "Games" },
  { id: 2, name: "Russian Roulette", price: 100, category: "Games" },
  { id: 3, name: "Cricket Game", price: 75, category: "Games" },
  { id: 4, name: "Beer Pong", price: 150, category: "Games" },
  { id: 5, name: "Biryani", price: 200, category: "Food" },
  { id: 6, name: "Samosa", price: 30, category: "Food" },
  { id: 7, name: "Masala Chai", price: 25, category: "Food" },
  { id: 8, name: "Dosa", price: 80, category: "Food" },
  { id: 9, name: "Beer", price: 250, category: "Liquor" },
  { id: 10, name: "Whiskey Shot", price: 150, category: "Liquor" },
  { id: 11, name: "Vodka Shot", price: 120, category: "Liquor" },
  { id: 12, name: "Event T-Shirt", price: 500, category: "Merchandise" },
];

export default function POS() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedWallet, setScannedWallet] = useState<any>(null);
  const [selectedItems, setSelectedItems] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleScanWallet = async () => {
    setIsScanning(true);
    
    try {
      const result = nfcManager.isNFCSupported() 
        ? await nfcManager.startScanning()
        : await nfcManager.simulateNFCScan();
      
      if (result.success) {
        // In production, this would query your database for the wallet
        // For now, show "no wallet found" since we removed test data
        toast({
          title: "No Wallet Found",
          description: `NFC tag ${result.tagId} scanned but no wallet is linked to this tag. Please issue this tag first.`,
          variant: "destructive",
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

  const addItem = (item: any) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const removeItem = (itemId: number) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.id === itemId);
      if (existing && existing.quantity > 1) {
        return prev.map(i => i.id === itemId ? { ...i, quantity: i.quantity - 1 } : i);
      }
      return prev.filter(i => i.id !== itemId);
    });
  };

  const totalAmount = selectedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const handleProcessSale = async () => {
    if (!scannedWallet || selectedItems.length === 0) {
      toast({
        title: "Cannot Process Sale",
        description: "Please scan a wallet and select items to purchase.",
        variant: "destructive",
      });
      return;
    }

    if (totalAmount > scannedWallet.currentBalance) {
      toast({
        title: "Insufficient Balance",
        description: `Balance: ₹${scannedWallet.currentBalance.toFixed(2)} | Required: ₹${totalAmount.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const newBalance = scannedWallet.currentBalance - totalAmount;
      
      toast({
        title: "Sale Completed",
        description: `₹${totalAmount.toFixed(2)} charged. New balance: ₹${newBalance.toFixed(2)}`,
      });

      // Reset state
      setScannedWallet({ ...scannedWallet, currentBalance: newBalance });
      setSelectedItems([]);
    } catch (error) {
      toast({
        title: "Sale Failed",
        description: "There was an error processing the sale. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const categories = [...new Set(menuItems.map(item => item.category))];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Point of Sale</h1>
        <p className="text-muted-foreground mt-2">Process purchases and deduct from digital wallets</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Menu Items */}
        <div className="lg:col-span-2">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Package className="w-5 h-5 text-primary" />
                <span>Menu Items</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {categories.map(category => (
                <div key={category} className="mb-6">
                  <h3 className="text-lg font-semibold text-foreground mb-3">{category}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {menuItems.filter(item => item.category === category).map(item => (
                      <div 
                        key={item.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-smooth cursor-pointer"
                        onClick={() => addItem(item)}
                      >
                        <div>
                          <div className="font-medium text-foreground">{item.name}</div>
                          <div className="text-sm text-muted-foreground">{category}</div>
                        </div>
                        <div className="text-lg font-bold text-primary">
                          ₹{item.price.toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Cart & Wallet */}
        <div className="space-y-6">
          {/* Wallet Scanner */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Scan className="w-5 h-5 text-primary" />
                <span>Customer Wallet</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleScanWallet}
                disabled={isScanning}
                className="w-full bg-gradient-primary hover:shadow-hover transition-smooth"
              >
                {isScanning ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    <span>Scanning...</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <Scan className="w-4 h-4" />
                    <span>Scan NFC Tag</span>
                  </div>
                )}
              </Button>

              {scannedWallet && (
                <div className="bg-success/10 border border-success/20 rounded-lg p-4">
                  <div className="flex items-center space-x-3 mb-3">
                    <CheckCircle className="w-5 h-5 text-success" />
                    <div>
                      <div className="font-medium text-foreground">{scannedWallet.attendeeName}</div>
                      <div className="text-sm text-muted-foreground">{scannedWallet.tagId}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-success/20">
                    <span className="text-sm font-medium text-muted-foreground">Balance</span>
                    <span className="text-lg font-bold text-success">
                      ₹{scannedWallet.currentBalance.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shopping Cart */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <ShoppingCart className="w-5 h-5 text-primary" />
                <span>Cart</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingCart className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No items selected</p>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {selectedItems.map(item => (
                      <div key={item.id} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium text-foreground">{item.name}</div>
                          <div className="text-sm text-muted-foreground">
                            ₹{item.price.toFixed(2)} each
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => removeItem(item.id)}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <Badge variant="secondary">{item.quantity}</Badge>
                          <div className="font-bold text-foreground min-w-[60px] text-right">
                            ₹{(item.price * item.quantity).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex items-center justify-between text-lg font-bold">
                      <span className="text-foreground">Total</span>
                      <span className="text-primary">₹{totalAmount.toFixed(2)}</span>
                    </div>
                  </div>

                  <Button
                    onClick={handleProcessSale}
                    disabled={!scannedWallet || isProcessing || totalAmount > (scannedWallet?.currentBalance || 0)}
                    className="w-full bg-gradient-primary hover:shadow-hover transition-smooth"
                  >
                    {isProcessing ? (
                      <div className="flex items-center space-x-2">
                        <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                        <span>Processing...</span>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <DollarSign className="w-4 h-4" />
                        <span>Charge ₹{totalAmount.toFixed(2)}</span>
                      </div>
                    )}
                  </Button>

                  {scannedWallet && totalAmount > scannedWallet.currentBalance && (
                    <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-center space-x-2">
                      <AlertCircle className="w-4 h-4 text-destructive" />
                      <span className="text-sm text-destructive">Insufficient balance</span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}