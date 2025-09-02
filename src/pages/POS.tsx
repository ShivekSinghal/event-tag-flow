import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { nfcManager } from "@/utils/nfc";
import { supabase } from "@/integrations/supabase/client";
import { 
  ShoppingCart, 
  Scan, 
  CheckCircle, 
  AlertCircle,
  Minus,
  DollarSign,
  Package
} from "lucide-react";

interface Game {
  id: string;
  name: string;
  description: string;
  price: number;
  studio: string;
}

interface SelectedItem extends Game {
  quantity: number;
}

export default function POS() {
  const { toast } = useToast();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedWallet, setScannedWallet] = useState<any>(null);
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(true);

  useEffect(() => {
    fetchGames();
  }, []);

  const fetchGames = async () => {
    try {
      const { data: gamesData, error } = await supabase
        .from('games')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      setGames(gamesData || []);
    } catch (error) {
      toast({
        title: "Error Loading Games",
        description: "Failed to load games. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingGames(false);
    }
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

        // Check if wallet is blocked
        if (wallet.status === 'blocked') {
          toast({
            title: "Tag Blocked",
            description: `This NFC tag has been blocked and cannot be used for transactions. Contact admin for assistance.`,
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

  const addItem = (game: Game) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.id === game.id);
      if (existing) {
        return prev.map(i => i.id === game.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...game, quantity: 1 }];
    });
  };

  const removeItem = (gameId: string) => {
    setSelectedItems(prev => {
      const existing = prev.find(i => i.id === gameId);
      if (existing && existing.quantity > 1) {
        return prev.map(i => i.id === gameId ? { ...i, quantity: i.quantity - 1 } : i);
      }
      return prev.filter(i => i.id !== gameId);
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
      const newBalance = scannedWallet.currentBalance - totalAmount;
      
      // Update wallet balance in Supabase
      const { error: updateError } = await supabase
        .from('wallets')
        .update({ balance: newBalance })
        .eq('id', scannedWallet.id);

      if (updateError) {
        throw updateError;
      }

      // Create transaction record first
      const itemsDescription = selectedItems.map(item => 
        `${item.name} x${item.quantity}`
      ).join(', ');

      const { data: transactionData, error: transactionError } = await supabase
        .from('transactions')
        .insert({
          wallet_id: scannedWallet.id,
          type: 'spend',
          amount: -totalAmount, // Negative for spending
          description: `POS Purchase: ${itemsDescription}`,
          reference: `POS_${Date.now()}`
        })
        .select()
        .single();

      if (transactionError) {
        throw transactionError;
      }

      // Create game sales records for each item
      const gameSalesRecords = selectedItems.map(item => ({
        game_id: item.id,
        transaction_id: transactionData.id,
        quantity: item.quantity,
        sale_price: item.price * item.quantity
      }));

      const { error: salesError } = await supabase
        .from('game_sales')
        .insert(gameSalesRecords);

      if (salesError) {
        throw salesError;
      }
      
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
                <span>Available Games</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingGames ? (
                <div className="text-center py-8">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-muted-foreground">Loading games...</p>
                </div>
              ) : games.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No games available</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {games.map(game => (
                    <div 
                      key={game.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-smooth cursor-pointer"
                      onClick={() => addItem(game)}
                    >
                      <div>
                        <div className="font-medium text-foreground">{game.name}</div>
                        <div className="text-sm text-muted-foreground">{game.description}</div>
                      </div>
                      <div className="text-lg font-bold text-primary">
                        ₹{typeof game.price === 'string' ? parseFloat(game.price).toFixed(2) : game.price.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                            ₹{typeof item.price === 'string' ? parseFloat(item.price).toFixed(2) : item.price.toFixed(2)} each
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
                            ₹{(typeof item.price === 'string' ? parseFloat(item.price) * item.quantity : item.price * item.quantity).toFixed(2)}
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