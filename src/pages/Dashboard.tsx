import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  CreditCard
} from "lucide-react";

interface DashboardStats {
  totalWallets: number;
  totalBalance: number;
  todaysSales: number;
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

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalWallets: 0,
    totalBalance: 0,
    todaysSales: 0,
    activeTags: 0
  });
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [lowBalanceAlerts, setLowBalanceAlerts] = useState<LowBalanceAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

      // Fetch today's transactions for sales calculation
      const today = new Date();
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      
      const { data: todaysTransactions, error: transactionsError } = await supabase
        .from('transactions')
        .select('amount')
        .gte('created_at', todayStart.toISOString())
        .lt('created_at', todayEnd.toISOString())
        .eq('type', 'spend');

      if (transactionsError) throw transactionsError;

      const todaysSales = Math.abs(todaysTransactions?.reduce((sum, tx) => {
        const amount = typeof tx.amount === 'string' ? parseFloat(tx.amount) : tx.amount;
        return sum + Math.abs(amount);
      }, 0) || 0);

      setStats({
        totalWallets,
        totalBalance,
        todaysSales,
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
      title: "Today's Sales",
      value: isLoading ? "..." : `₹${stats.todaysSales.toFixed(2)}`,
      change: stats.todaysSales > 0 ? "Revenue generated today" : "No transactions yet",
      icon: TrendingUp,
      color: "text-accent"
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
            <Card key={stat.title} className="shadow-card hover:shadow-hover transition-smooth">
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
      </div>
    </div>
  );
}

function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}