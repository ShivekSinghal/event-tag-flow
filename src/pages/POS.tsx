import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { nfcManager } from "@/utils/nfc";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFlyingCards } from "@/hooks/use-flying-cards";
import { useStaffPermissions } from "@/hooks/use-staff-permissions";
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

interface DrinkItem {
  id: string;
  name: string;
  price: number;
  category: string;
}

interface CustomItem {
  id: string;
  name: string;
  type: 'food' | 'game';
  requiresCustomAmount: boolean;
}

export default function POS() {
  const { toast } = useToast();
  const { profile, isStaff } = useAuth();
  const { addCard } = useFlyingCards();
  const { 
    getGamePermissions, 
    hasFoodPermission, 
    hasDrinksPermission, 
    isLoading: permissionsLoading 
  } = useStaffPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [scannedWallet, setScannedWallet] = useState<any>(null);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [selectedDrink, setSelectedDrink] = useState<DrinkItem | null>(null);
  const [selectedCustomItem, setSelectedCustomItem] = useState<CustomItem | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [showCustomAmountInput, setShowCustomAmountInput] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [activeSection, setActiveSection] = useState<'games' | 'drinks' | 'food'>('games');

  // Drinks data
  const drinkItems: DrinkItem[] = [
    { id: 'hashtag-specials', name: 'Hashtag Specials', price: 1000, category: 'Specials' },
    { id: 'classic-cocktails', name: 'Classic Cocktails', price: 500, category: 'Cocktails' },
    { id: 'ogs', name: "OG's", price: 500, category: 'Cocktails' },
    { id: 'mocktails', name: 'Mocktails', price: 300, category: 'Mocktails' },
  ];

  // Custom items data
  const customItems: CustomItem[] = [
    { id: 'food-menu', name: 'Food Menu', type: 'food', requiresCustomAmount: true },
    { id: 'dunk-company-member', name: 'Dunk a Company Member', type: 'game', requiresCustomAmount: true },
    { id: 'karaoke', name: 'Karaoke', type: 'game', requiresCustomAmount: true },
  ];

  // Handle section switching based on permissions
  useEffect(() => {
    if (!permissionsLoading) {
      const hasGames = getGamePermissions().length > 0;
      const hasFood = hasFoodPermission();
      const hasDrinks = hasDrinksPermission();
      
      // Auto-select first available section
      if (activeSection === 'games' && !hasGames) {
        if (hasDrinks) setActiveSection('drinks');
        else if (hasFood) setActiveSection('food');
      } else if (activeSection === 'drinks' && !hasDrinks) {
        if (hasGames) setActiveSection('games');
        else if (hasFood) setActiveSection('food');
      } else if (activeSection === 'food' && !hasFood) {
        if (hasGames) setActiveSection('games');
        else if (hasDrinks) setActiveSection('drinks');
      }
    }
  }, [permissionsLoading, getGamePermissions, hasFoodPermission, hasDrinksPermission, activeSection]);

  // Load games based on staff permissions
  useEffect(() => {
    if (!permissionsLoading) {
      const permittedGames = getGamePermissions();
      setGames(permittedGames.map(g => ({ 
        ...g, 
        available: true, 
        description: '', 
        price: 0 
      })));
      setIsLoadingGames(false);
    }
  }, [getGamePermissions, permissionsLoading]);

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
    setSelectedDrink(null);
    setSelectedCustomItem(null);
    setShowCustomAmountInput(false);
    toast({
      title: "Scanning Started",
      description: `Selected ${game.name} (₹${game.price.toFixed(2)}). Please scan the customer's NFC tag.`,
    });
    
    // Automatically start NFC scanning
    await handleScanForPayment(game.price, `${game.name}`, game.id);
  };

  const handleDrinkSelect = async (drink: DrinkItem) => {
    if (isScanning || isProcessing) {
      return;
    }
    
    setSelectedDrink(drink);
    setSelectedGame(null);
    setSelectedCustomItem(null);
    setShowCustomAmountInput(false);
    toast({
      title: "Scanning Started",
      description: `Selected ${drink.name} (₹${drink.price.toFixed(2)}). Please scan the customer's NFC tag.`,
    });
    
    // Automatically start NFC scanning
    await handleScanForPayment(drink.price, `${drink.name}`, null);
  };

  const handleCustomItemSelect = (item: CustomItem) => {
    if (isScanning || isProcessing) {
      return;
    }
    
    setSelectedCustomItem(item);
    setSelectedGame(null);
    setSelectedDrink(null);
    setShowCustomAmountInput(true);
    setCustomAmount('');
    toast({
      title: "Enter Amount",
      description: `Selected ${item.name}. Please enter the amount.`,
    });
  };

  const handleCustomAmountConfirm = async () => {
    if (!selectedCustomItem || !customAmount) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount.",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(customAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount greater than 0.",
        variant: "destructive",
      });
      return;
    }

    setShowCustomAmountInput(false);
    toast({
      title: "Scanning Started",
      description: `Selected ${selectedCustomItem.name} (₹${amount.toFixed(2)}). Please scan the customer's NFC tag.`,
    });
    
    // Automatically start NFC scanning
    await handleScanForPayment(amount, selectedCustomItem.name, null);
  };

  const handleScanForPayment = async (price: number, itemName: string, gameId: string | null) => {
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
          resetTransaction();
          return;
        }

        // Check if wallet is blocked
        if (wallet.status === 'blocked') {
          toast({
            title: "Tag Blocked",
            description: `This NFC tag has been blocked and cannot be used for transactions. Contact admin for assistance.`,
            variant: "destructive",
          });
          resetTransaction();
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
        await processPayment(formattedWallet, price, itemName, gameId);
      } else {
        toast({
          title: "Scanning Failed",
          description: result.error || "Could not scan NFC tag. Please try again.",
          variant: "destructive",
        });
        resetTransaction();
      }
    } catch (error) {
      toast({
        title: "Scanning Failed",
        description: "Could not scan NFC tag. Please try again.",
        variant: "destructive",
      });
      resetTransaction();
    } finally {
      setIsScanning(false);
    }
  };

  const processPayment = async (wallet: any, price: number, itemName: string, gameId: string | null) => {
    if (price > wallet.currentBalance) {
      toast({
        title: "Insufficient Balance",
        description: `Balance: ₹${wallet.currentBalance.toFixed(2)} | Required: ₹${price.toFixed(2)}`,
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    try {
      const newBalance = wallet.currentBalance - price;
      
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
          amount: -price,
          description: `POS Purchase: ${itemName}`,
          reference: `POS_${Date.now()}`,
          game_id: gameId
        })
        .select()
        .single();

      if (transactionError) {
        throw transactionError;
      }

      // Create game sales record only if it's a game purchase
      if (gameId) {
        const { error: salesError } = await supabase
          .from('game_sales')
          .insert({
            game_id: gameId,
            transaction_id: transactionData.id,
            quantity: 1,
            sale_price: price
          });

        if (salesError) {
          throw salesError;
        }
      }
      
      toast({
        title: "Payment Successful!",
        description: `₹${price.toFixed(2)} charged for ${itemName}. New balance: ₹${newBalance.toFixed(2)}`,
      });

      // Show flying card animation
      addCard({
        amount: price,
        name: wallet.attendeeName,
        studio: selectedGame?.studio || selectedDrink?.category || selectedCustomItem?.type || 'POS',
        type: "sale"
      });

      // Reset state
      setScannedWallet({ ...wallet, currentBalance: newBalance });
      resetTransaction();
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
    setSelectedDrink(null);
    setSelectedCustomItem(null);
    setScannedWallet(null);
    setShowCustomAmountInput(false);
    setCustomAmount('');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-foreground">Point of Sale</h1>
        <p className="text-muted-foreground mt-2">Select items, scan NFC tag, and process payment instantly</p>
      </div>

      {/* Check if user has any permissions */}
      {!permissionsLoading && getGamePermissions().length === 0 && !hasFoodPermission() && !hasDrinksPermission() && (
        <Card className="shadow-card">
          <CardContent className="text-center py-8">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Access Permissions</h3>
            <p className="text-muted-foreground">
              You don't have access to any POS sections. Please contact an admin to assign you permissions for games, food, or drinks.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Show sections only if user has permissions */}
      {!permissionsLoading && (getGamePermissions().length > 0 || hasFoodPermission() || hasDrinksPermission()) && (
        <>
          {/* Section Tabs */}
          <div className="flex justify-center space-x-4">
            {(getGamePermissions().length > 0) && (
              <Button 
                variant={activeSection === 'games' ? 'default' : 'outline'}
                onClick={() => setActiveSection('games')}
                className="flex items-center space-x-2"
              >
                <Package className="w-4 h-4" />
                <span>Games</span>
              </Button>
            )}
            {hasDrinksPermission() && (
              <Button 
                variant={activeSection === 'drinks' ? 'default' : 'outline'}
                onClick={() => setActiveSection('drinks')}
                className="flex items-center space-x-2"
              >
                <CreditCard className="w-4 h-4" />
                <span>Drinks</span>
              </Button>
            )}
            {hasFoodPermission() && (
              <Button 
                variant={activeSection === 'food' ? 'default' : 'outline'}
                onClick={() => setActiveSection('food')}
                className="flex items-center space-x-2"
              >
                <DollarSign className="w-4 h-4" />
                <span>Food & Custom</span>
              </Button>
            )}
          </div>

      {/* Transaction Flow */}
      <div className="flex items-center justify-center space-x-4 text-sm text-muted-foreground">
        <div className={`flex items-center space-x-2 ${(selectedGame || selectedDrink || selectedCustomItem) ? 'text-success' : 'text-muted-foreground'}`}>
          <div className={`w-3 h-3 rounded-full ${(selectedGame || selectedDrink || selectedCustomItem) ? 'bg-success' : 'bg-muted'}`} />
          <span>Select Item</span>
        </div>
        <ArrowRight className="w-4 h-4" />
        <div className={`flex items-center space-x-2 ${scannedWallet ? 'text-success' : (selectedGame || selectedDrink || selectedCustomItem) ? 'text-foreground' : 'text-muted-foreground'}`}>
          <div className={`w-3 h-3 rounded-full ${scannedWallet ? 'bg-success' : (selectedGame || selectedDrink || selectedCustomItem) ? 'bg-primary' : 'bg-muted'}`} />
          <span>Scan NFC Tag</span>
        </div>
        <ArrowRight className="w-4 h-4" />
        <div className={`flex items-center space-x-2 ${scannedWallet && !isProcessing ? 'text-success' : 'text-muted-foreground'}`}>
          <div className={`w-3 h-3 rounded-full ${scannedWallet && !isProcessing ? 'bg-success' : 'bg-muted'}`} />
          <span>Payment Complete</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {activeSection === 'games' && <Package className="w-5 h-5 text-primary" />}
                  {activeSection === 'drinks' && <CreditCard className="w-5 h-5 text-primary" />}
                  {activeSection === 'food' && <DollarSign className="w-5 h-5 text-primary" />}
                  <span>
                    {activeSection === 'games' && 'Available Games'}
                    {activeSection === 'drinks' && 'Drinks Menu'}
                    {activeSection === 'food' && 'Food & Custom Items'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {(selectedGame || selectedDrink || selectedCustomItem) && (
                    <Button variant="outline" size="sm" onClick={resetTransaction}>
                      Reset
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Games Section */}
              {activeSection === 'games' && (
                <>
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
                </>
              )}

              {/* Drinks Section */}
              {activeSection === 'drinks' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {drinkItems.map(drink => (
                    <div 
                      key={drink.id}
                      className={`flex items-center justify-between p-4 border rounded-lg transition-smooth cursor-pointer ${
                        selectedDrink?.id === drink.id 
                          ? "bg-primary/10 border-primary" 
                          : "hover:bg-secondary/50"
                      }`}
                      onClick={() => handleDrinkSelect(drink)}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-foreground">{drink.name}</span>
                          {selectedDrink?.id === drink.id && (
                            <Badge variant="default" className="text-xs">
                              Selected
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">{drink.category}</div>
                      </div>
                      <div className={`text-lg font-bold ${
                        selectedDrink?.id === drink.id ? "text-primary" : "text-primary"
                      }`}>
                        ₹{drink.price.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Food & Custom Section */}
              {activeSection === 'food' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {customItems
                      .filter(item => {
                        // Only show food items if user only has food permission
                        if (item.type === 'food') return hasFoodPermission();
                        // Only show game items if user has game permissions
                        if (item.type === 'game') return getGamePermissions().length > 0;
                        return false;
                      })
                      .map(item => (
                      <div 
                        key={item.id}
                        className={`flex items-center justify-between p-4 border rounded-lg transition-smooth cursor-pointer ${
                          selectedCustomItem?.id === item.id 
                            ? "bg-primary/10 border-primary" 
                            : "hover:bg-secondary/50"
                        }`}
                        onClick={() => handleCustomItemSelect(item)}
                      >
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-foreground">{item.name}</span>
                            {selectedCustomItem?.id === item.id && (
                              <Badge variant="default" className="text-xs">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground capitalize">{item.type}</div>
                        </div>
                        <div className="text-sm font-medium text-muted-foreground">
                          Custom Amount
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Custom Amount Input */}
                  {showCustomAmountInput && selectedCustomItem && (
                    <Card className="border-primary/20">
                      <CardHeader>
                        <CardTitle className="text-lg">Enter Amount for {selectedCustomItem.name}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Predefined Amount Buttons for Games */}
                        {selectedCustomItem.type === 'game' && (
                          <div>
                            <p className="text-sm text-muted-foreground mb-3">Quick Select Amount:</p>
                            <div className="grid grid-cols-4 gap-2 mb-4">
                              {[1, 50, 100, 200, 500, 1000, 2000].map(amount => (
                                <Button
                                  key={amount}
                                  variant={customAmount === amount.toString() ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => setCustomAmount(amount.toString())}
                                  className="h-12"
                                >
                                  ₹{amount}
                                </Button>
                              ))}
                            </div>
                            <div className="text-center text-sm text-muted-foreground mb-3">
                              Or enter custom amount:
                            </div>
                          </div>
                        )}
                        
                        <div className="flex items-center space-x-4">
                          <div className="flex-1">
                            <Input
                              type="number"
                              placeholder="Enter amount (₹)"
                              value={customAmount}
                              onChange={(e) => setCustomAmount(e.target.value)}
                              min="0"
                              step="0.01"
                            />
                          </div>
                          <Button 
                            onClick={handleCustomAmountConfirm}
                            disabled={!customAmount || parseFloat(customAmount) <= 0}
                          >
                            Confirm & Scan
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Transaction Panel */}
        <div className="space-y-6">
          {/* Selected Item */}
          {(selectedGame || selectedDrink || selectedCustomItem) && (
            <Card className="shadow-card border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  <span>Selected Item</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                  <div className="font-medium text-foreground">
                    {selectedGame?.name || selectedDrink?.name || selectedCustomItem?.name}
                  </div>
                  <div className="text-sm text-muted-foreground mb-3">
                    {selectedGame?.description || selectedDrink?.category || `${selectedCustomItem?.type} - Custom Amount`}
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-primary/20">
                    <span className="text-sm font-medium text-muted-foreground">Price</span>
                    <span className="text-lg font-bold text-primary">
                      {selectedGame && `₹${selectedGame.price.toFixed(2)}`}
                      {selectedDrink && `₹${selectedDrink.price.toFixed(2)}`}
                      {selectedCustomItem && customAmount && `₹${parseFloat(customAmount).toFixed(2)}`}
                      {selectedCustomItem && !customAmount && (
                        <span className="text-muted-foreground">Enter amount below</span>
                      )}
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
              {(selectedGame || selectedDrink || (selectedCustomItem && customAmount)) ? (
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
                  <span className="text-sm text-warning">
                    {showCustomAmountInput ? 'Enter amount to continue' : 'Select an item to start payment process'}
                  </span>
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
        </>
      )}
    </div>
  );
}