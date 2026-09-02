import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Gamepad2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'staff' | 'studio_manager';
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const { user, profile, loading } = useAuth();

  if (loading || (user && !profile)) {
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
