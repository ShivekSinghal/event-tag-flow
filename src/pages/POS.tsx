import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFlyingCards } from "@/hooks/use-flying-cards";
import { useStaffPermissions } from "@/hooks/use-staff-permissions";
import { nfcManager } from "@/utils/nfc";
import { useState, useEffect } from "react";
import { 
  Package, 
  CreditCard, 
  DollarSign, 
  Scan, 
  AlertCircle, 
  ArrowRight, 
  CheckCircle,
  Calculator
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
  const [calculatorItems, setCalculatorItems] = useState<{name: string, price: number, quantity: number}[]>([]);
  const [showCalculator, setShowCalculator] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [games, setGames] = useState<Game[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [activeSection, setActiveSection] = useState<'games' | 'drinks' | 'food' | 'custom-games'>('games');

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
      const hasCustomGames = getGamePermissions().some(game => 
        ['Dunk a Company Member', 'Karaoke'].includes(game.name)
      );
      
      // If no active section is set or current section is not available, set default
      const availableSections = [];
      if (hasGames) availableSections.push('games');
      if (hasCustomGames) availableSections.push('custom-games');
      if (hasDrinks) availableSections.push('drinks');
      if (hasFood) availableSections.push('food');
      
      if (availableSections.length > 0 && !availableSections.includes(activeSection)) {
        setActiveSection(availableSections[0] as any);
      }
    }
  }, [permissionsLoading, getGamePermissions, hasFoodPermission, hasDrinksPermission, activeSection]);

  // Load games from database with actual prices
  useEffect(() => {
    const fetchGames = async () => {
      if (!permissionsLoading) {
        const permittedGameIds = getGamePermissions().map(g => g.id);
        
        if (permittedGameIds.length > 0) {
          const { data: gamesData, error } = await supabase
            .from('games')
            .select('*')
            .in('id', permittedGameIds)
            .eq('available', true);
          
          if (!error && gamesData) {
            // Filter out games that should only appear as custom amount items
            const regularGames = gamesData.filter(g => 
              !['Dunk a Company Member', 'Karaoke'].includes(g.name)
            );
            
            setGames(regularGames.map(g => ({
              id: g.id,
              name: g.name,
              description: g.description || '',
              price: typeof g.price === 'string' ? parseFloat(g.price) : g.price,
              studio: g.studio,
              available: g.available
            })));
          }
        } else {
          setGames([]);
        }
        setIsLoadingGames(false);
      }
    };
    
    fetchGames();
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
    await handleScanForPayment(game.price, `${game.name}`, game.id, 'games');
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
    await handleScanForPayment(drink.price, `${drink.name}`, null, 'drinks');
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
    const itemType = selectedCustomItem.type === 'game' ? 'games' : 'food';
    await handleScanForPayment(amount, selectedCustomItem.name, null, itemType);
  };

  const handleScanForPayment = async (price: number, itemName: string, gameId: string | null, transactionType: string = 'food') => {
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
        await processPayment(formattedWallet, price, itemName, gameId, transactionType);
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

  const processPayment = async (wallet: any, price: number, itemName: string, gameId: string | null, transactionType: string = 'food') => {
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
          type: transactionType,
          amount: -price,
          description: `${transactionType === 'drinks' ? 'Drinks' : transactionType === 'games' ? 'Game' : 'Food'} Purchase: ${itemName}`,
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
    <div className="max-w-7xl mx-auto space-y-4 px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="text-center py-4">
        <div className="flex items-center justify-center space-x-3 mb-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Point of Sale</h1>
        </div>
        <p className="text-sm sm:text-base text-muted-foreground mt-2">
          Tap items, scan NFC tag, process payment instantly
        </p>
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
      {!permissionsLoading && (getGamePermissions().length > 0 || hasFoodPermission() || hasDrinksPermission() || getGamePermissions().some(game => ['Dunk a Company Member', 'Karaoke'].includes(game.name))) && (
        <>
          {/* Section Tabs */}
          <div className="flex flex-wrap justify-center gap-2 px-4">
            {(getGamePermissions().length > 0) && (
              <Button 
                variant={activeSection === 'games' ? 'default' : 'outline'}
                onClick={() => setActiveSection('games')}
                className="flex items-center space-x-2 text-xs sm:text-sm"
                size="sm"
              >
                <Package className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden xs:inline">Games</span>
                <span className="xs:hidden">🎮</span>
              </Button>
            )}
            {hasDrinksPermission() && (
              <Button 
                variant={activeSection === 'drinks' ? 'default' : 'outline'}
                onClick={() => setActiveSection('drinks')}
                className="flex items-center space-x-2 text-xs sm:text-sm"
                size="sm"
              >
                <CreditCard className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden xs:inline">Drinks</span>
                <span className="xs:hidden">🥤</span>
              </Button>
            )}
            {(getGamePermissions().some(game => ['Dunk a Company Member', 'Karaoke'].includes(game.name))) && (
              <Button 
                variant={activeSection === 'custom-games' ? 'default' : 'outline'}
                onClick={() => setActiveSection('custom-games')}
                className="flex items-center space-x-2 text-xs sm:text-sm"
                size="sm"
              >
                <DollarSign className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden xs:inline">Custom Games</span>
                <span className="xs:hidden">🎯</span>
              </Button>
            )}
            {hasFoodPermission() && (
              <Button 
                variant={activeSection === 'food' ? 'default' : 'outline'}
                onClick={() => setActiveSection('food')}
                className="flex items-center space-x-2 text-xs sm:text-sm"
                size="sm"
              >
                <DollarSign className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden xs:inline">Food & Custom</span>
                <span className="xs:hidden">🍽️</span>
              </Button>
            )}
          </div>

      {/* Transaction Flow */}
      <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-4 text-xs sm:text-sm text-muted-foreground px-4">
        <div className={`flex items-center space-x-2 ${(selectedGame || selectedDrink || selectedCustomItem) ? 'text-success' : 'text-muted-foreground'}`}>
          <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${(selectedGame || selectedDrink || selectedCustomItem) ? 'bg-success' : 'bg-muted'}`} />
          <span>Select Item</span>
        </div>
        <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 rotate-90 sm:rotate-0" />
        <div className={`flex items-center space-x-2 ${scannedWallet ? 'text-success' : (selectedGame || selectedDrink || selectedCustomItem) ? 'text-foreground' : 'text-muted-foreground'}`}>
          <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${scannedWallet ? 'bg-success' : (selectedGame || selectedDrink || selectedCustomItem) ? 'bg-primary' : 'bg-muted'}`} />
          <span>Scan NFC Tag</span>
        </div>
        <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 rotate-90 sm:rotate-0" />
        <div className={`flex items-center space-x-2 ${scannedWallet && !isProcessing ? 'text-success' : 'text-muted-foreground'}`}>
          <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full ${scannedWallet && !isProcessing ? 'bg-success' : 'bg-muted'}`} />
          <span>Payment Complete</span>
        </div>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-3 gap-4 lg:gap-8">
        {/* Main Content Area */}
        <div className="lg:col-span-2 order-1 lg:order-1">
          <Card className="shadow-card">
            <CardHeader className="pb-4">
              <CardTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  {activeSection === 'games' && <Package className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />}
                  {activeSection === 'drinks' && <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />}
                  {activeSection === 'food' && <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />}
                  {activeSection === 'custom-games' && <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />}
                  <span className="text-sm sm:text-base">
                    {activeSection === 'games' && 'Available Games'}
                    {activeSection === 'drinks' && 'Drinks Menu'}
                    {activeSection === 'food' && 'Food & Custom Items'}
                    {activeSection === 'custom-games' && 'Custom Amount Games'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {(selectedGame || selectedDrink || selectedCustomItem) && (
                    <Button variant="outline" size="sm" onClick={resetTransaction} className="text-xs">
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
                    <div className="grid grid-cols-1 gap-3">
                      {games.map(game => (
                        <div 
                          key={game.id}
                          className={`flex items-center justify-between p-3 sm:p-4 border rounded-lg transition-smooth ${
                            selectedGame?.id === game.id 
                              ? "bg-primary/10 border-primary" 
                              : game.available 
                                ? "hover:bg-secondary/50 cursor-pointer active:bg-secondary/70" 
                                : "bg-destructive/5 border-destructive/20 cursor-not-allowed opacity-60"
                          }`}
                          onClick={() => game.available && handleGameSelect(game)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="font-medium text-foreground text-sm sm:text-base truncate">{game.name}</span>
                              {selectedGame?.id === game.id && (
                                <Badge variant="default" className="text-xs shrink-0">
                                  ✓ Selected
                                </Badge>
                              )}
                              {!game.available && (
                                <Badge variant="destructive" className="text-xs shrink-0">
                                  ❌ Sold Out
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs sm:text-sm text-muted-foreground mt-1">{game.description}</p>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <span className="font-bold text-sm sm:text-lg text-success">₹{game.price.toFixed(2)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Drinks Section */}
              {activeSection === 'drinks' && (
                <div className="grid grid-cols-1 gap-3">
                  {drinkItems.map(drink => (
                    <div 
                      key={drink.id}
                      className={`flex items-center justify-between p-3 sm:p-4 border rounded-lg transition-smooth cursor-pointer active:bg-secondary/70 ${
                        selectedDrink?.id === drink.id 
                          ? "bg-primary/10 border-primary" 
                          : "hover:bg-secondary/50"
                      }`}
                      onClick={() => handleDrinkSelect(drink)}
                    >
                        <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-foreground text-sm sm:text-base truncate">{drink.name}</span>
                          {selectedDrink?.id === drink.id && (
                            <Badge variant="default" className="text-xs shrink-0">
                              ✓ Selected
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs sm:text-sm text-muted-foreground mt-1">{drink.category}</div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <span className="font-bold text-sm sm:text-lg text-success">₹{drink.price.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Food & Custom Section */}
              {activeSection === 'food' && (
                <div className="space-y-4">
                  {/* Food Calculator Toggle */}
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <h3 className="text-base sm:text-lg font-medium">Food Items</h3>
                    <Button
                      variant="outline"
                      onClick={() => setShowCalculator(!showCalculator)}
                      className="flex items-center space-x-2 w-full sm:w-auto text-xs sm:text-sm"
                      size="sm"
                    >
                      <Calculator className="w-3 h-3 sm:w-4 sm:h-4" />
                      <span>{showCalculator ? 'Hide Calculator' : 'Show Calculator'}</span>
                    </Button>
                  </div>

                  {/* Food Calculator */}
                  {showCalculator && (
                    <Card className="border-primary/20">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base sm:text-lg">Food Calculator</CardTitle>
                        <p className="text-xs sm:text-sm text-muted-foreground">Add multiple dishes to calculate total before payment</p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Dish Dropdown */}
                        <div className="space-y-2">
                          <Label htmlFor="dish-select" className="text-xs sm:text-sm">Select Dish</Label>
                          <Select 
                            onValueChange={(value) => {
                              const [name, price] = value.split('|');
                              setCalculatorItems([...calculatorItems, {name, price: parseFloat(price), quantity: 1}]);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Choose a dish to add" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Butter Chicken|250">Butter Chicken - ₹250</SelectItem>
                              <SelectItem value="Dal Makhani|180">Dal Makhani - ₹180</SelectItem>
                              <SelectItem value="Biryani|220">Biryani - ₹220</SelectItem>
                              <SelectItem value="Naan|60">Naan - ₹60</SelectItem>
                              <SelectItem value="Paneer Tikka|200">Paneer Tikka - ₹200</SelectItem>
                              <SelectItem value="Samosa|40">Samosa - ₹40</SelectItem>
                              <SelectItem value="Chole Bhature|150">Chole Bhature - ₹150</SelectItem>
                              <SelectItem value="Masala Dosa|120">Masala Dosa - ₹120</SelectItem>
                              <SelectItem value="Chicken Tikka|240">Chicken Tikka - ₹240</SelectItem>
                              <SelectItem value="Fried Rice|140">Fried Rice - ₹140</SelectItem>
                              <SelectItem value="Garlic Bread|80">Garlic Bread - ₹80</SelectItem>
                              <SelectItem value="Caesar Salad|160">Caesar Salad - ₹160</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Calculator Items List */}
                        {calculatorItems.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="font-medium text-sm sm:text-base">Added Items:</h4>
                            {calculatorItems.map((item, index) => (
                              <div key={index} className="flex items-center justify-between p-2 sm:p-3 border rounded-lg">
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm sm:text-base truncate">{item.name}</div>
                                  <div className="text-xs sm:text-sm text-muted-foreground">₹{item.price.toFixed(2)} each</div>
                                </div>
                                <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const newItems = [...calculatorItems];
                                      if (newItems[index].quantity > 1) {
                                        newItems[index].quantity -= 1;
                                        setCalculatorItems(newItems);
                                      }
                                    }}
                                    className="w-6 h-6 sm:w-8 sm:h-8 p-0 text-xs"
                                  >
                                    -
                                  </Button>
                                  <span className="w-6 sm:w-8 text-center text-xs sm:text-sm">{item.quantity}</span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const newItems = [...calculatorItems];
                                      newItems[index].quantity += 1;
                                      setCalculatorItems(newItems);
                                    }}
                                    className="w-6 h-6 sm:w-8 sm:h-8 p-0 text-xs"
                                  >
                                    +
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => {
                                      setCalculatorItems(calculatorItems.filter((_, i) => i !== index));
                                    }}
                                    className="w-6 h-6 sm:w-8 sm:h-8 p-0 text-xs"
                                  >
                                    ×
                                  </Button>
                                </div>
                              </div>
                            ))}
                            
                            {/* Total and Pay */}
                            <div className="border-t pt-4">
                              <div className="flex justify-between items-center mb-4">
                                <span className="text-base sm:text-lg font-bold">Total:</span>
                                <span className="text-lg sm:text-2xl font-bold text-primary">
                                  ₹{calculatorItems.reduce((total, item) => total + (item.price * item.quantity), 0).toFixed(2)}
                                </span>
                              </div>
                              <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                                <Button
                                  variant="outline"
                                  onClick={() => setCalculatorItems([])}
                                  className="flex-1 text-xs sm:text-sm"
                                  size="sm"
                                >
                                  Clear All
                                </Button>
                                <Button
                                  onClick={() => {
                                    const total = calculatorItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                                    const itemNames = calculatorItems.map(item => `${item.name} (${item.quantity}x)`).join(', ');
                                    handleScanForPayment(total, itemNames, null);
                                  }}
                                  disabled={calculatorItems.length === 0}
                                  className="flex-1 text-xs sm:text-sm"
                                  size="sm"
                                >
                                  Scan & Pay
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {customItems
                      .filter(item => {
                        // Show food items if user has food permission
                        if (item.type === 'food') return hasFoodPermission();
                        // Don't show game items here - they are in Custom Games section
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

              {/* Custom Games Section */}
              {activeSection === 'custom-games' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    {customItems
                      .filter(item => {
                        // Only show game-type custom items that the user has specific permission for
                        if (item.type === 'game') {
                          const gamePermissions = getGamePermissions();
                          return gamePermissions.some(game => game.name === item.name);
                        }
                        return false;
                      })
                      .map(item => (
                      <div 
                        key={item.id}
                        className={`flex items-center justify-between p-3 sm:p-4 border rounded-lg transition-smooth cursor-pointer active:bg-secondary/70 ${
                          selectedCustomItem?.id === item.id 
                            ? "bg-primary/10 border-primary" 
                            : "hover:bg-secondary/50"
                        }`}
                        onClick={() => handleCustomItemSelect(item)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-foreground text-sm sm:text-base truncate">{item.name}</span>
                            {selectedCustomItem?.id === item.id && (
                              <Badge variant="default" className="text-xs shrink-0">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs sm:text-sm text-muted-foreground mt-1 capitalize">{item.type}</div>
                        </div>
                        <div className="text-xs sm:text-sm font-medium text-muted-foreground shrink-0">
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
        <div className="order-2 lg:order-2">
          <div className="sticky top-4 space-y-4">
            {/* Selected Item */}
            {(selectedGame || selectedDrink || selectedCustomItem) && (
              <Card className="shadow-card border-primary/20">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center space-x-2 text-sm sm:text-base">
                    <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                    <span>Selected Item</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 sm:p-4">
                    <div className="font-medium text-foreground text-sm sm:text-base">
                      {selectedGame?.name || selectedDrink?.name || selectedCustomItem?.name}
                    </div>
                    <div className="text-xs sm:text-sm text-muted-foreground mb-3">
                      {selectedGame?.description || selectedDrink?.category || `${selectedCustomItem?.type} - Custom Amount`}
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-primary/20">
                      <span className="text-xs sm:text-sm font-medium text-muted-foreground">Price</span>
                      <span className="text-base sm:text-lg font-bold text-primary">
                        {selectedGame && `₹${selectedGame.price.toFixed(2)}`}
                        {selectedDrink && `₹${selectedDrink.price.toFixed(2)}`}
                        {selectedCustomItem && customAmount && `₹${parseFloat(customAmount).toFixed(2)}`}
                        {selectedCustomItem && !customAmount && (
                          <span className="text-muted-foreground text-xs">Enter amount below</span>
                        )}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* NFC Scanner */}
            <Card className="shadow-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center space-x-2 text-sm sm:text-base">
                  <Scan className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  <span>Customer Payment</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(selectedGame || selectedDrink || (selectedCustomItem && customAmount)) ? (
                  <div className="text-center py-4">
                    {isProcessing ? (
                      <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-2 text-primary">
                        <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <span className="font-medium text-xs sm:text-sm">Processing Payment...</span>
                      </div>
                    ) : isScanning ? (
                      <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-2 text-primary">
                        <div className="w-5 h-5 sm:w-6 sm:h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <span className="font-medium text-xs sm:text-sm">Scanning for NFC Tag...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row items-center justify-center space-y-2 sm:space-y-0 sm:space-x-2 text-muted-foreground">
                        <div className="relative">
                          <Scan className="w-5 h-5 sm:w-6 sm:h-6" />
                          <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-ping"></div>
                        </div>
                        <span className="font-medium text-xs sm:text-sm">Please scan customer's NFC tag</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                    <span className="text-xs sm:text-sm text-warning">
                      {showCustomAmountInput ? 'Enter amount to continue' : 'Select an item to start payment process'}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Scanned Wallet Display */}
            {scannedWallet && (
              <Card className="shadow-card border-success/20">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center space-x-2 text-sm sm:text-base">
                    <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-success" />
                    <span>Customer Wallet</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-success/10 border border-success/20 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center space-x-3 mb-3">
                      <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 text-success shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground text-sm sm:text-base truncate">{scannedWallet.attendeeName}</div>
                        <div className="text-xs sm:text-sm text-muted-foreground">{scannedWallet.tagId}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-success/20">
                      <span className="text-xs sm:text-sm font-medium text-muted-foreground">Balance</span>
                      <span className="text-base sm:text-lg font-bold text-success">
                        ₹{scannedWallet.currentBalance.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}