import { Outlet, Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { 
  CreditCard, 
  LayoutDashboard, 
  NfcIcon as Nfc, 
  ShoppingCart, 
  Users,
  Wallet,
  LogOut,
  Menu,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Issue Tag", href: "/issue-tag", icon: Nfc },
  { name: "Top Up", href: "/topup", icon: Wallet },
  { name: "POS Sale", href: "/pos", icon: ShoppingCart },
  { name: "Check Balance", href: "/balance", icon: CreditCard },
];

export default function Layout() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { profile, signOut, isAdmin, isStaff } = useAuth();
  
  // Filter navigation based on user role
  const filteredNavigation = navigation.filter(item => {
    if (isAdmin) return true; // Admin can see all
    if (isStaff) return item.href === '/pos'; // Staff can only see POS
    return false;
  });
  
  const closeMobileMenu = () => setIsMobileMenuOpen(false);
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b shadow-card sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              {isMobile && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  className="md:hidden"
                >
                  {isMobileMenuOpen ? (
                    <X className="w-5 h-5" />
                  ) : (
                    <Menu className="w-5 h-5" />
                  )}
                </Button>
              )}
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center">
                  <Nfc className="w-5 h-5 text-primary-foreground" />
                </div>
                <h1 className="text-xl font-bold text-foreground">Pink'D wallet system</h1>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {profile?.role === 'admin' ? 'Admin Portal' : 'Staff Portal'}
              </span>
              <Button variant="ghost" size="sm" onClick={signOut}>
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Mobile Menu Overlay */}
        {isMobile && isMobileMenuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={closeMobileMenu} />
            <aside className="fixed left-0 top-16 bottom-0 w-64 bg-card border-r shadow-card">
              <nav className="p-4">
                <ul className="space-y-2">
                  {filteredNavigation.map((item) => {
                    const isActive = location.pathname === item.href;
                    const Icon = item.icon;
                    
                    return (
                      <li key={item.name}>
                        <Link
                          to={item.href}
                          onClick={closeMobileMenu}
                          className={cn(
                            "flex items-center space-x-3 px-3 py-2 rounded-lg transition-smooth hover:bg-secondary",
                            isActive 
                              ? "bg-primary text-primary-foreground shadow-hover" 
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon className="w-5 h-5" />
                          <span className="font-medium">{item.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </aside>
          </div>
        )}

        {/* Desktop Sidebar */}
        <aside className="hidden md:block w-64 bg-card border-r min-h-[calc(100vh-4rem)] shadow-card">
          <nav className="p-4">
            <ul className="space-y-2">
              {filteredNavigation.map((item) => {
                const isActive = location.pathname === item.href;
                const Icon = item.icon;
                
                return (
                  <li key={item.name}>
                    <Link
                      to={item.href}
                      className={cn(
                        "flex items-center space-x-3 px-3 py-2 rounded-lg transition-smooth hover:bg-secondary",
                        isActive 
                          ? "bg-primary text-primary-foreground shadow-hover" 
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-medium">{item.name}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}