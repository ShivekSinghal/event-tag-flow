import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Settings, 
  Users, 
  Package, 
  MapPin, 
  Shield,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Plus
} from "lucide-react";

const adminStats = [
  {
    title: "Total Revenue",
    value: "₹0",
    change: "No sales yet",
    icon: DollarSign,
    color: "text-success"
  },
  {
    title: "Active Wallets",
    value: "0",
    change: "Start issuing tags",
    icon: Users,
    color: "text-primary"
  },
  {
    title: "Items Sold",
    value: "0",
    change: "Ready to begin",
    icon: Package,
    color: "text-accent"
  },
  {
    title: "Low Balance",
    value: "0",
    change: "All good",
    icon: AlertTriangle,
    color: "text-warning"
  }
];

const staffMembers: any[] = [];

const menuItems = [
  { name: "Masala Chai", price: 25, category: "Food", sold: 0, revenue: 0 },
  { name: "Beer Pong", price: 150, category: "Games", sold: 0, revenue: 0 },
  { name: "Event T-Shirt", price: 500, category: "Merchandise", sold: 0, revenue: 0 },
  { name: "Biryani", price: 200, category: "Food", sold: 0, revenue: 0 },
];

const booths = [
  { name: "Main Food Court", location: "Central Plaza", revenue: 0, transactions: 0 },
  { name: "Games Arena", location: "Stage Area", revenue: 0, transactions: 0 },
  { name: "Merchandise Booth", location: "Entrance", revenue: 0, transactions: 0 },
  { name: "Liquor Counter", location: "VIP Zone", revenue: 0, transactions: 0 },
];

export default function Admin() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-2">Manage your event wallet system</p>
        </div>
        <Badge variant="outline" className="border-success text-success px-3 py-1">
          Live Data
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {adminStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="shadow-card hover:shadow-hover transition-smooth">
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <Icon className={`w-5 h-5 ${stat.color}`} />
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
        {/* Top Selling Items */}
        <Card className="shadow-card">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <span>Top Selling Items</span>
            </CardTitle>
            <Button size="sm" variant="outline">
              <Settings className="w-4 h-4 mr-2" />
              Manage Items
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {menuItems.map((item, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="font-medium text-foreground">{item.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {item.category} • ₹{item.price.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-success">₹{item.revenue.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">{item.sold} sold</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Booth Performance */}
      <Card className="shadow-card">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <MapPin className="w-5 h-5 text-primary" />
            <span>Booth Performance</span>
          </CardTitle>
          <Button size="sm" variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            Add Booth
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {booths.map((booth, index) => (
              <div key={index} className="p-4 border rounded-lg hover:bg-secondary/30 transition-smooth">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-semibold text-foreground">{booth.name}</div>
                    <div className="text-sm text-muted-foreground flex items-center space-x-1">
                      <MapPin className="w-3 h-3" />
                      <span>{booth.location}</span>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {booth.transactions} txns
                  </Badge>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-primary">
                    ₹{booth.revenue.toFixed(2)}
                  </div>
                  <div className="text-xs text-muted-foreground">Today's revenue</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Shield className="w-5 h-5 text-primary" />
            <span>Quick Actions</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Button variant="outline" className="h-16 flex-col space-y-2">
              <Package className="w-5 h-5" />
              <span className="text-sm">Update Menu</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col space-y-2">
              <MapPin className="w-5 h-5" />
              <span className="text-sm">Booth Settings</span>
            </Button>
            <Button variant="outline" className="h-16 flex-col space-y-2">
              <AlertTriangle className="w-5 h-5" />
              <span className="text-sm">Block Tags</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}