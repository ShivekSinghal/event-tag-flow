import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { 
  Wallet, 
  TrendingUp, 
  Users, 
  AlertTriangle,
  DollarSign,
  CreditCard,
  Plus,
  Package,
  Utensils,
  Shield,
  ShieldOff,
  Search,
  XCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { nfcManager } from "@/utils/nfc";
import StaffManagement from "@/components/admin/StaffManagement";

interface DashboardStats {
  totalWallets: number;
  totalBalance: number;
  totalSales: number;
  activeTags: number;
}

interface Transaction {
  id: string;
  type: string;
  description: string;
  amount: number;
  created_at: string;
  wallet: {
    attendee_name: string;
    balance: number;
  };
}

interface LowBalanceAlert {
  id: string;
  tag_id: string;
  attendee_name: string;
  attendee_phone: string;
  balance: number;
}

interface StudioSales {
  studio: string;
  totalSales: number;
  transactionCount: number;
}

interface GameSales {
  game_id: string;
  game_name: string;
  studio: string;
  total_quantity: number;
  total_revenue: number;
  available: boolean;
}

interface Booking {
  id: string;
  user_name: string;
  user_phone: string;
  user_email: string;
  studio_location: string;
  package_name: string;
  amount: number;
  booking_date: string;
  payment_status: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalWallets: 0,
    totalBalance: 0,
    totalSales: 0,
    activeTags: 0
  });
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [lowBalanceAlerts, setLowBalanceAlerts] = useState<LowBalanceAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [studioSales, setStudioSales] = useState<StudioSales[]>([]);
  const [gameSales, setGameSales] = useState<GameSales[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [itemForm, setItemForm] = useState({
    name: '',
    description: '',
    price: '',
    category: 'games'
  });
  
  // Block Tag functionality state
  const [isBlockTagOpen, setIsBlockTagOpen] = useState(false);
  const [phoneSearchQuery, setPhoneSearchQuery] = useState('');
  const [foundWallet, setFoundWallet] = useState<any>(null);
  const [blockedWallets, setBlockedWallets] = useState<any[]>([]);
  
  // Bookings search and expand state
  const [bookingSearchQuery, setBookingSearchQuery] = useState('');
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [showAllBookings, setShowAllBookings] = useState(false);
  
  const { toast } = useToast();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      
      // Fetch wallet stats
      const { data: wallets, error: walletsError } = await supabase
        .from('wallets')
        .select('*');

      if (walletsError) throw walletsError;

      // Calculate stats
      const totalWallets = wallets?.length || 0;
      const totalBalance = wallets?.reduce((sum, wallet) => {
        const balance = typeof wallet.balance === 'string' ? parseFloat(wallet.balance) : wallet.balance;
        return sum + balance;
      }, 0) || 0;
      const activeTags = wallets?.filter(wallet => wallet.status === 'active').length || 0;

      // Fetch all sales transactions
      const { data: allSalesTransactions, error: transactionsError } = await supabase
        .from('transactions')
        .select('amount')
        .eq('type', 'spend');

      if (transactionsError) throw transactionsError;

      const totalSales = Math.abs(allSalesTransactions?.reduce((sum, tx) => {
        const amount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;
        return sum + Math.abs(amount);
      }, 0) || 0);

      setStats({
        totalWallets,
        totalBalance,
        totalSales,
        activeTags
      });

      // Fetch recent transactions with wallet data
      const { data: transactionsData, error: recentTxError } = await supabase
        .from('transactions')
        .select(`
          id,
          type,
          description,
          amount,
          created_at,
          wallets!inner(attendee_name, balance)
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      if (recentTxError) throw recentTxError;

      // Transform the data to match our interface
      const transformedTransactions: Transaction[] = transactionsData?.map(tx => ({
        id: tx.id,
        type: tx.type,
        description: tx.description,
        amount: tx.amount,
        created_at: tx.created_at,
        wallet: {
          attendee_name: (tx.wallets as any).attendee_name,
          balance: (tx.wallets as any).balance
        }
      })) || [];

      setRecentTransactions(transformedTransactions);

      // Fetch low balance wallets (less than ₹50)
      const { data: lowBalanceWallets, error: lowBalanceError } = await supabase
        .from('wallets')
        .select('id, tag_id, attendee_name, attendee_phone, balance')
        .lt('balance', 50)
        .eq('status', 'active');

      if (lowBalanceError) throw lowBalanceError;

      setLowBalanceAlerts(lowBalanceWallets || []);

      // Fetch studio sales data
      await fetchStudioSalesData();

      // Fetch game sales data
      await fetchGameSalesData();

      // Fetch blocked wallets
      await fetchBlockedWallets();

      // Fetch bookings
      await fetchBookings();

    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast({
        title: "Error Loading Dashboard",
        description: "Failed to load dashboard data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStudioSalesData = async () => {
    try {
      // Fetch sales transactions with wallet studio information
      const { data: salesData, error } = await supabase
        .from('transactions')
        .select(`
          amount,
          wallets!inner(studio)
        `)
        .eq('type', 'spend');

      if (error) throw error;

      // Group sales by studio
      const studioSalesMap = new Map<string, { totalSales: number; transactionCount: number }>();
      
      salesData?.forEach((transaction: any) => {
        const studio = transaction.wallets.studio;
        const amount = Math.abs(typeof transaction.amount === 'string' ? parseFloat(transaction.amount) : transaction.amount);
        
        if (studioSalesMap.has(studio)) {
          const existing = studioSalesMap.get(studio)!;
          studioSalesMap.set(studio, {
            totalSales: existing.totalSales + amount,
            transactionCount: existing.transactionCount + 1
          });
        } else {
          studioSalesMap.set(studio, {
            totalSales: amount,
            transactionCount: 1
          });
        }
      });

      // Convert to array and sort by total sales
      const studioSalesArray: StudioSales[] = Array.from(studioSalesMap.entries())
        .map(([studio, data]) => ({
          studio,
          totalSales: data.totalSales,
          transactionCount: data.transactionCount
        }))
        .sort((a, b) => b.totalSales - a.totalSales);

      setStudioSales(studioSalesArray);
    } catch (error) {
      toast({
        title: "Error Loading Sales Breakdown",
        description: "Failed to load sales data by studio. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleTotalSalesClick = () => {
    // Refresh studio sales data
    fetchStudioSalesData();
  };

  const fetchGameSalesData = async () => {
    try {
      // First fetch all games to show availability status
      const { data: allGames, error: gamesError } = await supabase
        .from('games')
        .select('id, name, studio, available');

      if (gamesError) throw gamesError;

      // Fetch game sales data with aggregated quantities and revenue
      const { data: salesData, error } = await supabase
        .from('game_sales')
        .select(`
          game_id,
          quantity,
          sale_price,
          games!inner(name, studio, available)
        `);

      if (error) throw error;

      // Group sales by game
      const gameSalesMap = new Map<string, { 
        game_name: string; 
        studio: string; 
        total_quantity: number; 
        total_revenue: number; 
        available: boolean;
      }>();
      
      salesData?.forEach((sale: any) => {
        const gameId = sale.game_id;
        const gameName = sale.games.name;
        const studio = sale.games.studio;
        const available = sale.games.available;
        const quantity = sale.quantity;
        const revenue = typeof sale.sale_price === 'string' ? parseFloat(sale.sale_price) : sale.sale_price;
        
        if (gameSalesMap.has(gameId)) {
          const existing = gameSalesMap.get(gameId)!;
          gameSalesMap.set(gameId, {
            game_name: gameName,
            studio: studio,
            available: available,
            total_quantity: existing.total_quantity + quantity,
            total_revenue: existing.total_revenue + revenue
          });
        } else {
          gameSalesMap.set(gameId, {
            game_name: gameName,
            studio: studio,
            available: available,
            total_quantity: quantity,
            total_revenue: revenue
          });
        }
      });

      // Add games that haven't been sold yet
      allGames?.forEach((game: any) => {
        if (!gameSalesMap.has(game.id)) {
          gameSalesMap.set(game.id, {
            game_name: game.name,
            studio: game.studio,
            available: game.available,
            total_quantity: 0,
            total_revenue: 0
          });
        }
      });

      // Convert to array and sort by total quantity
      const gameSalesArray: GameSales[] = Array.from(gameSalesMap.entries())
        .map(([game_id, data]) => ({
          game_id,
          game_name: data.game_name,
          studio: data.studio,
          available: data.available,
          total_quantity: data.total_quantity,
          total_revenue: data.total_revenue
        }))
        .sort((a, b) => b.total_quantity - a.total_quantity);

      setGameSales(gameSalesArray);
    } catch (error) {
      toast({
        title: "Error Loading Game Sales",
        description: "Failed to load game sales data. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleAddItem = async () => {
    if (!itemForm.name || !itemForm.price) {
      toast({
        title: "Missing Information",
        description: "Please fill in name and price",
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('games')
        .insert({
          name: itemForm.name,
          description: itemForm.description || null,
          price: parseFloat(itemForm.price),
          studio: itemForm.category === 'games' ? 'General' : 'General'
        });

      if (error) throw error;

      toast({
        title: "Item Added Successfully",
        description: `${itemForm.name} has been added to the system`,
      });

      // Reset form
      setItemForm({
        name: '',
        description: '',
        price: '',
        category: 'games'
      });
      setIsAddItemOpen(false);

      // Refresh game sales to show new item
      fetchGameSalesData();
    } catch (error) {
      console.error('Error adding item:', error);
      toast({
        title: "Error Adding Item",
        description: "Failed to add item. Please try again.",
        variant: "destructive",
      });
    }
  };

  const fetchBlockedWallets = async () => {
    try {
      const { data: blocked, error } = await supabase
        .from('wallets')
        .select('*')
        .eq('status', 'blocked')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setBlockedWallets(blocked || []);
    } catch (error) {
      console.error('Error fetching blocked wallets:', error);
    }
  };

  const fetchBookings = async () => {
    try {
      const { data: bookingsData, error } = await supabase
        .from('bookings')
        .select('*')
        .order('booking_date', { ascending: false });

      if (error) throw error;
      setAllBookings(bookingsData || []);
      setBookings(bookingsData?.slice(0, 10) || []);
    } catch (error) {
      console.error('Error fetching bookings:', error);
      toast({
        title: "Error Loading Bookings",
        description: "Failed to load bookings data. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSearchWallet = async () => {
    if (!phoneSearchQuery.trim()) {
      toast({
        title: "Enter Phone Number",
        description: "Please enter a phone number to search.",
        variant: "destructive",
      });
      return;
    }

    try {
      const { data: wallet, error } = await supabase
        .from('wallets')
        .select('*')
        .eq('attendee_phone', phoneSearchQuery.trim())
        .single();

      if (error || !wallet) {
        toast({
          title: "No Wallet Found",
          description: `No wallet found with phone number ${phoneSearchQuery}.`,
          variant: "destructive",
        });
        setFoundWallet(null);
        return;
      }

      setFoundWallet(wallet);
      
      toast({
        title: "Wallet Found",
        description: `Found wallet for ${wallet.attendee_name}`,
      });
    } catch (error) {
      toast({
        title: "Search Failed",
        description: "Could not search for wallet. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleToggleBlockStatus = async () => {
    if (!foundWallet) return;

    try {
      const newStatus = foundWallet.status === 'blocked' ? 'active' : 'blocked';
      
      const { error } = await supabase
        .from('wallets')
        .update({ 
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', foundWallet.id);

      if (error) throw error;

      // Update local state
      setFoundWallet({ ...foundWallet, status: newStatus });
      
      // Refresh blocked wallets list and dashboard stats
      await fetchBlockedWallets();
      await fetchDashboardData();

      toast({
        title: newStatus === 'blocked' ? "Tag Blocked" : "Tag Unblocked",
        description: `${foundWallet.attendee_name}'s wallet has been ${newStatus}.`,
        variant: newStatus === 'blocked' ? "destructive" : "default",
      });

      // Close dialog after successful action
      setIsBlockTagOpen(false);
      setFoundWallet(null);
      setPhoneSearchQuery('');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update wallet status. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Filter bookings based on search query
  const filteredBookings = showAllBookings ? allBookings : bookings;
  const displayBookings = filteredBookings.filter(booking => 
    bookingSearchQuery === '' || 
    booking.user_name.toLowerCase().includes(bookingSearchQuery.toLowerCase()) ||
    booking.user_phone.includes(bookingSearchQuery) ||
    booking.user_email.toLowerCase().includes(bookingSearchQuery.toLowerCase())
  );

  const handleToggleShowAllBookings = () => {
    setShowAllBookings(!showAllBookings);
  };

  const handleToggleGameAvailability = async (gameId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('games')
        .update({ 
          available: !currentStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', gameId);

      if (error) throw error;

      toast({
        title: !currentStatus ? "Game Made Available" : "Game Marked as Sold Out",
        description: !currentStatus ? "Game is now available for sale" : "Game is now marked as sold out",
        variant: !currentStatus ? "default" : "destructive",
      });

      // Refresh game sales data
      await fetchGameSalesData();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update game availability. Please try again.",
        variant: "destructive",
      });
    }
  };

  const statsConfig = [
    {
      title: "Total Wallets",
      value: isLoading ? "..." : stats.totalWallets.toString(),
      change: stats.totalWallets > 0 ? `${stats.totalWallets} wallet${stats.totalWallets === 1 ? '' : 's'} issued` : "Start issuing tags",
      icon: Users,
      color: "text-primary"
    },
    {
      title: "Total Balance",
      value: isLoading ? "..." : `₹${stats.totalBalance.toFixed(2)}`,
      change: stats.totalBalance > 0 ? "Available in wallets" : "No funds loaded",
      icon: Wallet,
      color: "text-success"
    },
    {
      title: "Total Sales",
      value: isLoading ? "..." : `₹${stats.totalSales.toFixed(2)}`,
      change: stats.totalSales > 0 ? "Total revenue generated" : "No transactions yet",
      icon: TrendingUp,
      color: "text-accent",
      clickable: true
    },
    {
      title: "Active Tags",
      value: isLoading ? "..." : stats.activeTags.toString(),
      change: stats.activeTags > 0 ? `${stats.activeTags} active wallet${stats.activeTags === 1 ? '' : 's'}` : "Ready to begin",
      icon: CreditCard,
      color: "text-warning"
    }
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Overview of your event wallet system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statsConfig.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card 
              key={stat.title} 
              className={cn(
                "shadow-card hover:shadow-hover transition-smooth",
                (stat as any).clickable ? "cursor-pointer" : ""
              )}
              onClick={(stat as any).clickable ? handleTotalSalesClick : undefined}
            >
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <Icon className={cn("w-5 h-5", stat.color)} />
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-20 mb-1" />
                ) : (
                  <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                )}
                <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Staff Management Section */}
      <StaffManagement />

      {/* Studio Sales Breakdown - Always Visible */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <span>Sales Breakdown by Studio</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <Skeleton className="w-8 h-8 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-20" />
                        <Skeleton className="h-3 w-24" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-16" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : studioSales.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No sales data available</p>
                <p className="text-sm">Sales breakdown will appear once transactions are recorded</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {studioSales.map((studioData, index) => (
                  <div key={studioData.studio} className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{studioData.studio}</div>
                        <div className="text-sm text-muted-foreground">
                          {studioData.transactionCount} transaction{studioData.transactionCount === 1 ? '' : 's'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg text-success">₹{studioData.totalSales.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">
                        {stats.totalSales > 0 ? `${((studioData.totalSales / stats.totalSales) * 100).toFixed(1)}%` : '0%'} of total
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Game Sales Section */}
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-foreground">Game Sales Analytics & Item Management</h2>
        <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="flex items-center space-x-2">
              <Plus className="w-4 h-4" />
              <span>Add Item</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Add New Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={itemForm.category}
                  onValueChange={(value) => setItemForm(prev => ({ ...prev, category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="games">
                       <div className="flex items-center space-x-2">
                         <Package className="w-4 h-4" />
                         <span>Games</span>
                       </div>
                     </SelectItem>
                     <SelectItem value="general">
                       <div className="flex items-center space-x-2">
                         <Utensils className="w-4 h-4" />
                         <span>General Items</span>
                       </div>
                     </SelectItem>
                   </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={itemForm.name}
                  onChange={(e) => setItemForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter item name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={itemForm.description}
                  onChange={(e) => setItemForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Enter item description"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price">Price (₹)</Label>
                <Input
                  id="price"
                  type="number"
                  value={itemForm.price}
                  onChange={(e) => setItemForm(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="Enter price"
                />
              </div>
              <div className="flex space-x-2 pt-4">
                <Button onClick={handleAddItem} className="flex-1">
                  Add Item
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setIsAddItemOpen(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Game Sales Breakdown - Always Visible */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <DollarSign className="w-5 h-5 text-primary" />
            <span>Game Sales Breakdown</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-secondary/30 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <Skeleton className="w-8 h-8 rounded-full" />
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-3 w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : gameSales.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No game sales data available</p>
                <p className="text-sm">Game sales will appear once purchases are made</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {gameSales.map((gameData, index) => (
                  <div key={gameData.game_id} className={cn(
                    "flex items-center justify-between p-4 rounded-lg border-l-4",
                    gameData.available 
                      ? "bg-secondary/30 border-l-success" 
                      : "bg-destructive/5 border-l-destructive"
                  )}>
                    <div className="flex items-center space-x-3">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold",
                        gameData.available 
                          ? "bg-primary text-primary-foreground" 
                          : "bg-destructive text-destructive-foreground"
                      )}>
                        {index + 1}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-medium text-foreground">{gameData.game_name}</span>
                          {!gameData.available && (
                            <Badge variant="destructive" className="text-xs">
                              Sold Out
                            </Badge>
                          )}
                          {gameData.available && (
                            <Badge variant="outline" className="text-xs border-success text-success">
                              Available
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {gameData.total_quantity} sold • Studio: {gameData.studio}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      <div className="text-right">
                        <div className="font-bold text-lg text-success">₹{gameData.total_revenue.toFixed(2)}</div>
                        <div className="text-xs text-muted-foreground">
                          Qty: {gameData.total_quantity}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={gameData.available ? "destructive" : "default"}
                        onClick={() => handleToggleGameAvailability(gameData.game_id, gameData.available)}
                        className="flex items-center space-x-1"
                      >
                        {gameData.available ? (
                          <>
                            <XCircle className="w-3 h-3" />
                            <span className="hidden sm:inline">Mark Sold Out</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            <span className="hidden sm:inline">Mark Available</span>
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>


      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Transactions */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <span>Recent Transactions</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentTransactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No transactions yet</p>
                  <p className="text-sm">Transactions will appear here once sales begin</p>
                </div>
              ) : (
                recentTransactions.map((transaction) => {
                  const amount = typeof transaction.amount === 'string' ? parseFloat(transaction.amount) : transaction.amount;
                  const walletBalance = typeof transaction.wallet.balance === 'string' ? parseFloat(transaction.wallet.balance) : transaction.wallet.balance;
                  
                  return (
                    <div key={transaction.id} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <Badge 
                            variant={transaction.type === "spend" ? "destructive" : "default"}
                            className="text-xs"
                          >
                            {transaction.type === "spend" ? "Sale" : transaction.type}
                          </Badge>
                          <span className="text-sm font-medium">{transaction.wallet.attendee_name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {transaction.description} • {new Date(transaction.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className={cn(
                          "font-medium",
                          amount > 0 ? "text-success" : "text-destructive"
                        )}>
                          {amount > 0 ? "+" : ""}₹{Math.abs(amount).toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Balance: ₹{walletBalance.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Low Balance Alerts */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-warning" />
              <span>Low Balance Alerts</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-3 border border-warning/20 bg-warning/5 rounded-lg">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-5 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : lowBalanceAlerts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No low balance alerts</p>
                  <p className="text-sm">Alerts will appear when wallets need top-up</p>
                </div>
              ) : (
                lowBalanceAlerts.map((alert) => {
                  const balance = typeof alert.balance === 'string' ? parseFloat(alert.balance) : alert.balance;
                  
                  return (
                    <div key={alert.id} className="flex items-center justify-between p-3 border border-warning/20 bg-warning/5 rounded-lg">
                      <div>
                        <div className="font-medium text-foreground">{alert.attendee_name}</div>
                        <div className="text-sm text-muted-foreground">{alert.tag_id} • {alert.attendee_phone}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-warning">₹{balance.toFixed(2)}</div>
                        <Badge variant="outline" className="text-xs border-warning text-warning">
                          Low Balance
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* All Bookings */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Users className="w-5 h-5 text-primary" />
                <span>All Bookings</span>
              </div>
              <div className="text-right">
                <div className="text-sm text-muted-foreground">Total Collected</div>
                <div className="text-lg font-bold text-success">
                  ₹{allBookings.reduce((total, booking) => {
                    const amount = typeof booking.amount === 'string' ? parseFloat(booking.amount) : booking.amount;
                    return total + amount;
                  }, 0).toFixed(2)}
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Search Input */}
              <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, phone, or email..."
                    value={bookingSearchQuery}
                    onChange={(e) => setBookingSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={handleToggleShowAllBookings}
                  className="flex items-center space-x-2"
                >
                  {showAllBookings ? (
                    <>
                      <ChevronUp className="w-4 h-4" />
                      <span>Show Less</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      <span>Show All ({allBookings.length})</span>
                    </>
                  )}
                </Button>
              </div>

              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : displayBookings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>{bookingSearchQuery ? 'No matching bookings found' : 'No bookings yet'}</p>
                  <p className="text-sm">{bookingSearchQuery ? 'Try a different search term' : 'Bookings will appear here once customers start booking'}</p>
                </div>
              ) : (
                displayBookings.map((booking) => {
                  const amount = typeof booking.amount === 'string' ? parseFloat(booking.amount) : booking.amount;
                  
                  return (
                    <div key={booking.id} className="flex items-center justify-between p-4 bg-secondary/50 rounded-lg border">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                            <Users className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <div className="font-medium text-foreground">{booking.user_name}</div>
                            <div className="text-sm text-muted-foreground">
                              {booking.user_phone} • {booking.user_email}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {booking.package_name} • {booking.studio_location}
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 ml-13">
                          <div className="text-xs text-muted-foreground">
                            Booked: {new Date(booking.booking_date).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-lg">₹{amount.toFixed(2)}</div>
                        <Badge 
                          variant={booking.payment_status === 'completed' ? 'default' : booking.payment_status === 'pending' ? 'secondary' : 'destructive'}
                          className="text-xs"
                        >
                          {booking.payment_status}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Block Tag Section */}
      <Card className="shadow-card border-destructive/20">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Shield className="w-5 h-5 text-destructive" />
              <span>Block Tag Management</span>
            </div>
            <Dialog open={isBlockTagOpen} onOpenChange={setIsBlockTagOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" className="flex items-center space-x-2">
                  <Shield className="w-4 h-4" />
                  <span>Block Tag</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Block/Unblock Tag by Phone</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="text-sm text-muted-foreground">
                    Enter a phone number to find and block or unblock the associated tag. Blocked tags cannot be used for transactions.
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number</Label>
                    <div className="flex space-x-2">
                      <Input
                        id="phone"
                        placeholder="Enter phone number"
                        value={phoneSearchQuery}
                        onChange={(e) => setPhoneSearchQuery(e.target.value)}
                        className="flex-1"
                      />
                      <Button 
                        onClick={handleSearchWallet}
                        variant="outline"
                        className="flex items-center space-x-2"
                      >
                        <Search className="w-4 h-4" />
                        <span>Search</span>
                      </Button>
                    </div>
                  </div>

                  {foundWallet && (
                    <div className={cn(
                      "border rounded-lg p-4",
                      foundWallet.status === 'blocked' 
                        ? "bg-destructive/10 border-destructive/20" 
                        : "bg-success/10 border-success/20"
                    )}>
                      <div className="flex items-center space-x-3 mb-3">
                        {foundWallet.status === 'blocked' ? (
                          <ShieldOff className="w-5 h-5 text-destructive" />
                        ) : (
                          <Shield className="w-5 h-5 text-success" />
                        )}
                        <div>
                          <div className="font-medium text-foreground">{foundWallet.attendee_name}</div>
                          <div className="text-sm text-muted-foreground">{foundWallet.attendee_phone} • {foundWallet.tag_id}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-3 border-t">
                        <div>
                          <div className="text-sm font-medium text-muted-foreground">Status</div>
                          <Badge 
                            variant={foundWallet.status === 'blocked' ? "destructive" : "default"}
                          >
                            {foundWallet.status === 'blocked' ? 'Blocked' : 'Active'}
                          </Badge>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-muted-foreground">Balance</div>
                          <div className="font-bold">₹{typeof foundWallet.balance === 'string' ? parseFloat(foundWallet.balance).toFixed(2) : foundWallet.balance.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {foundWallet && (
                    <div className="flex space-x-2 pt-4">
                      <Button 
                        onClick={handleToggleBlockStatus}
                        variant={foundWallet.status === 'blocked' ? "default" : "destructive"}
                        className="flex-1"
                      >
                        {foundWallet.status === 'blocked' ? (
                          <div className="flex items-center space-x-2">
                            <Shield className="w-4 h-4" />
                            <span>Unblock Tag</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-2">
                            <ShieldOff className="w-4 h-4" />
                            <span>Block Tag</span>
                          </div>
                        )}
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setIsBlockTagOpen(false);
                          setFoundWallet(null);
                          setPhoneSearchQuery('');
                        }}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {blockedWallets.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No blocked tags</p>
                <p className="text-sm">Blocked tags will appear here for management</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">
                  Currently Blocked Tags ({blockedWallets.length})
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {blockedWallets.map((wallet) => (
                    <div key={wallet.id} className="flex items-center justify-between p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                      <div className="flex items-center space-x-3">
                        <ShieldOff className="w-4 h-4 text-destructive" />
                        <div>
                          <div className="font-medium text-foreground">{wallet.attendee_name}</div>
                          <div className="text-sm text-muted-foreground">{wallet.attendee_phone} • {wallet.tag_id}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium text-destructive">Blocked</div>
                        <div className="text-xs text-muted-foreground">
                          ₹{typeof wallet.balance === 'string' ? parseFloat(wallet.balance).toFixed(2) : wallet.balance.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}