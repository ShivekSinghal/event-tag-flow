import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Wallet, 
  TrendingUp, 
  Users, 
  AlertTriangle,
  DollarSign,
  CreditCard
} from "lucide-react";

const stats = [
  {
    title: "Total Wallets",
    value: "0",
    change: "Start issuing tags",
    icon: Users,
    color: "text-primary"
  },
  {
    title: "Total Balance",
    value: "₹0",
    change: "No funds loaded",
    icon: Wallet,
    color: "text-success"
  },
  {
    title: "Today's Sales",
    value: "₹0",
    change: "No transactions yet",
    icon: TrendingUp,
    color: "text-accent"
  },
  {
    title: "Active Tags",
    value: "0",
    change: "Ready to begin",
    icon: CreditCard,
    color: "text-warning"
  }
];

const recentTransactions: any[] = [];

const lowBalanceAlerts: any[] = [];

export default function Dashboard() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Overview of your event wallet system</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
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
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
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
              {recentTransactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No transactions yet</p>
                  <p className="text-sm">Transactions will appear here once sales begin</p>
                </div>
              ) : (
                recentTransactions.map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <Badge 
                          variant={transaction.type === "Sale" ? "destructive" : "default"}
                          className="text-xs"
                        >
                          {transaction.type}
                        </Badge>
                        <span className="text-sm font-medium">{transaction.item}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{transaction.time}</p>
                    </div>
                    <div className="text-right">
                      <div className={cn(
                        "font-medium",
                        transaction.amount > 0 ? "text-success" : "text-destructive"
                      )}>
                        {transaction.amount > 0 ? "+" : ""}₹{Math.abs(transaction.amount).toFixed(2)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Balance: ₹{transaction.balance.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))
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
              {lowBalanceAlerts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No low balance alerts</p>
                  <p className="text-sm">Alerts will appear when wallets need top-up</p>
                </div>
              ) : (
                lowBalanceAlerts.map((alert) => (
                  <div key={alert.tag} className="flex items-center justify-between p-3 border border-warning/20 bg-warning/5 rounded-lg">
                    <div>
                      <div className="font-medium text-foreground">{alert.name}</div>
                      <div className="text-sm text-muted-foreground">{alert.tag} • {alert.phone}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-warning">₹{alert.balance.toFixed(2)}</div>
                      <Badge variant="outline" className="text-xs border-warning text-warning">
                        Low Balance
                      </Badge>
                    </div>
                  </div>
                ))
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