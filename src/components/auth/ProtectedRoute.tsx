import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Gamepad2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'staff' | 'studio_manager';
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const { user, profile, profileLoading, profileError, loading } = useAuth();

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Gamepad2 className="h-12 w-12 mx-auto mb-4 text-primary animate-pulse" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/pinkd-login" replace />;
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-lg">
          <Gamepad2 className="h-12 w-12 mx-auto mb-4 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Dashboard access unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {profileError || "Your login worked, but this account does not have a staff/admin profile yet."}
          </p>
          <Button asChild className="mt-5">
            <Link to="/pinkd-login">Go to Login</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (requiredRole && profile?.role !== requiredRole) {
    // Redirect based on user role
    const userRole = profile?.role;
    if (userRole === 'staff') {
      return <Navigate to="/pos" replace />;
    }
    if (userRole === 'studio_manager') {
      return <Navigate to="/issue-tag" replace />;
    }
    return <Navigate to="/pinkd-login" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
