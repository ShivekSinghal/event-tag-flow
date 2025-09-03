import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { nfcManager } from "@/utils/nfc";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { 
  Scan, 
  CheckCircle, 
  AlertCircle,
  DollarSign,
  Package,
  CreditCard,
  ArrowRight
} from "lucide-react";

interface Game {
  id: string;
  name: string;
  description: string;
  price: number;
  studio: string;
  available: boolean;
}

export default function POS() {
  const { toast } = useToast();
  const { profile, isStaff } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedWallet, setScannedWallet] = useState<any>(null);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(true);

  useEffect(() => {
    fetchGames();
  }, [profile, isStaff]);

  const fetchGames = async () => {
    try {
      let query = supabase
        .from('games')
        .select('*')
        .eq('available', true)
        .order('name');
      
      // For staff users, filter by assigned game
      if (isStaff && profile?.assigned_game_id) {
        query = query.eq('id', profile.assigned_game_id);
      }

      const { data: gamesData, error } = await query;

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

  const handleGameSelect = async (game: Game) => {
    if (!game.available) {
      toast({
        title: "Game Not Available",
        description: `${game.name} is currently sold out.`,
        variant: "destructive",
      });
      return;
    }

    if (isScanning || isProcessing) {
      return;
    }
    
    setSelectedGame(game);
    toast({
      title: "Scanning Started",
      description: `Selected ${game.name} (₹${game.price.toFixed(2)}). Please scan the customer's NFC tag.`,
    });
    
    // Automatically start NFC scanning
    await handleScanForPayment(game);
  };

  const handleScanForPayment = async (game: Game) => {
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
          setSelectedGame(null);
          return;
        }

        // Check if wallet is blocked
        if (wallet.status === 'blocked') {
          toast({
            title: "Tag Blocked",
            description: `This NFC tag has been blocked and cannot be used for transactions. Contact admin for assistance.`,
            variant: "destructive",
          });
          setSelectedGame(null);
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
        
        // Immediately process the payment
        await processPayment(formattedWallet, game);
      } else {
        toast({
          title: "Scanning Failed",
          description: result.error || "Could not scan NFC tag. Please try again.",
          variant: "destructive",
        });
        setSelectedGame(null);
      }
    } catch (error) {
      toast({
        title: "Scanning Failed",
        description: "Could not scan NFC tag. Please try again.",
        variant: "destructive",
      });
      setSelectedGame(null);
    } finally {
      setIsScanning(false);
    }
  };

  const processPayment = async (wallet: any, game: Game) => {
    if (game.price > wallet.currentBalance) {
      toast({
        title: "Insufficient Balance",
        description: `Balance: ₹${wallet.currentBalance.toFixed(2)} | Required: ₹${game.price.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      const newBalance = wallet.currentBalance - game.price;
      
      // Update wallet balance in Supabase
      const { error: updateError } = await supabase
        .from('wallets')
        .update({ balance: newBalance })
        .eq('id', wallet.id);

      if (updateError) {
        throw updateError;
      }

      // Create transaction record
      const { data: transactionData, error: transactionError } = await supabase
        .from('transactions')
        .insert({
          wallet_id: wallet.id,
          type: 'spend',
          amount: -game.price,
          description: `POS Purchase: ${game.name}`,
          reference: `POS_${Date.now()}`,
          game_id: game.id
        })
        .select()
        .single();

      if (transactionError) {
        throw transactionError;
      }

      // Create game sales record
      const { error: salesError } = await supabase
        .from('game_sales')
        .insert({
          game_id: game.id,
          transaction_id: transactionData.id,
          quantity: 1,
          sale_price: game.price
        });

      if (salesError) {
        throw salesError;
      }
      
      toast({
        title: "Payment Successful!",
        description: `₹${game.price.toFixed(2)} charged for ${game.name}. New balance: ₹${newBalance.toFixed(2)}`,
      });

      // Reset state
      setScannedWallet({ ...wallet, currentBalance: newBalance });
      setSelectedGame(null);
    } catch (error) {
      toast({
        title: "Payment Failed",
        description: "There was an error processing the payment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const resetTransaction = () => {
    setSelectedGame(null);
    setScannedWallet(null);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Point of Sale</h1>
        <p className="text-muted-foreground mt-2">Select a game, scan NFC tag, and process payment instantly</p>
      </div>

      {/* Transaction Flow */}
      <div className="flex items-center justify-center space-x-4 text-sm text-muted-foreground">
        <div className={`flex items-center space-x-2 ${selectedGame ? 'text-success' : 'text-muted-foreground'}`}>
          <div className={`w-3 h-3 rounded-full ${selectedGame ? 'bg-success' : 'bg-muted'}`} />
          <span>Select Game</span>
        </div>
        <ArrowRight className="w-4 h-4" />
        <div className={`flex items-center space-x-2 ${scannedWallet ? 'text-success' : selectedGame ? 'text-foreground' : 'text-muted-foreground'}`}>
          <div className={`w-3 h-3 rounded-full ${scannedWallet ? 'bg-success' : selectedGame ? 'bg-primary' : 'bg-muted'}`} />
          <span>Scan NFC Tag</span>
        </div>
        <ArrowRight className="w-4 h-4" />
        <div className={`flex items-center space-x-2 ${scannedWallet && !isProcessing ? 'text-success' : 'text-muted-foreground'}`}>
          <div className={`w-3 h-3 rounded-full ${scannedWallet && !isProcessing ? 'bg-success' : 'bg-muted'}`} />
          <span>Payment Complete</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Games */}
        <div className="lg:col-span-2">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Package className="w-5 h-5 text-primary" />
                  <span>Available Games</span>
                </div>
                {selectedGame && (
                  <Button variant="outline" size="sm" onClick={resetTransaction}>
                    Reset
                  </Button>
                )}
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
                      className={`flex items-center justify-between p-4 border rounded-lg transition-smooth ${
                        selectedGame?.id === game.id 
                          ? "bg-primary/10 border-primary" 
                          : game.available 
                            ? "hover:bg-secondary/50 cursor-pointer" 
                            : "bg-destructive/5 border-destructive/20 cursor-not-allowed opacity-60"
                      }`}
                      onClick={() => game.available && handleGameSelect(game)}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-foreground">{game.name}</span>
                          {selectedGame?.id === game.id && (
                            <Badge variant="default" className="text-xs">
                              Selected
                            </Badge>
                          )}
                          {!game.available && (
                            <Badge variant="destructive" className="text-xs">
                              Sold Out
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">{game.description}</div>
                      </div>
                      <div className={`text-lg font-bold ${
                        selectedGame?.id === game.id ? "text-primary" : 
                        game.available ? "text-primary" : "text-muted-foreground"
                      }`}>
                        ₹{typeof game.price === 'string' ? parseFloat(game.price).toFixed(2) : game.price.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Transaction Panel */}
        <div className="space-y-6">
          {/* Selected Game */}
          {selectedGame && (
            <Card className="shadow-card border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  <span>Selected Game</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                  <div className="font-medium text-foreground">{selectedGame.name}</div>
                  <div className="text-sm text-muted-foreground mb-3">{selectedGame.description}</div>
                  <div className="flex items-center justify-between pt-3 border-t border-primary/20">
                    <span className="text-sm font-medium text-muted-foreground">Price</span>
                    <span className="text-lg font-bold text-primary">
                      ₹{selectedGame.price.toFixed(2)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* NFC Scanner */}
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Scan className="w-5 h-5 text-primary" />
                <span>Customer Payment</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedGame ? (
                <div className="text-center py-4">
                  {isProcessing ? (
                    <div className="flex items-center justify-center space-x-2 text-primary">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="font-medium">Processing Payment...</span>
                    </div>
                  ) : isScanning ? (
                    <div className="flex items-center justify-center space-x-2 text-primary">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span className="font-medium">Scanning for NFC Tag...</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center space-x-2 text-muted-foreground">
                      <Scan className="w-6 h-6" />
                      <span className="font-medium">Please scan customer's NFC tag</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-warning" />
                  <span className="text-sm text-warning">Click on a game to start payment process</span>
                </div>
              )}

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
        </div>
      </div>
    </div>
  );
}