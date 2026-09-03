import React, { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Gamepad2, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: 'admin' | 'staff' | 'studio_manager';
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRole }) => {
  const { user, profile, profileLoading, profileError, loading } = useAuth();
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  const isRouteLoading = loading || profileLoading;

  useEffect(() => {
    if (!isRouteLoading) {
      setLoadingTimedOut(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLoadingTimedOut(true);
    }, 10000);

    return () => window.clearTimeout(timeoutId);
  }, [isRouteLoading]);

  if (isRouteLoading && !loadingTimedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050307] p-4 text-white">
        <div className="text-center">
          <Gamepad2 className="h-12 w-12 mx-auto mb-4 text-primary animate-pulse" />
          <p className="font-semibold text-white/70">Loading dashboard access...</p>
        </div>
      </div>
    );
  }

  if (isRouteLoading && loadingTimedOut) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050307] p-4 text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-[#111015] p-6 text-center shadow-[0_30px_90px_-40px_rgba(255,0,127,0.85)]">
          <Gamepad2 className="h-12 w-12 mx-auto mb-4 text-primary" />
          <h1 className="text-xl font-black">Dashboard access is taking too long</h1>
          <p className="mt-2 text-sm leading-6 text-white/62">
            Your session or staff profile did not finish loading. Refresh the page, or log in again from the Pink'D admin login.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button type="button" onClick={() => window.location.reload()} className="bg-primary font-bold text-black hover:bg-primary/90">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button asChild variant="outline" className="border-white/15 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white">
              <Link to="/pinkd-login">Go to Login</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/pinkd-login" replace />;
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050307] p-4 text-white">
        <div className="max-w-md rounded-2xl border border-white/10 bg-[#111015] p-6 text-center shadow-[0_30px_90px_-40px_rgba(255,0,127,0.85)]">
          <Gamepad2 className="h-12 w-12 mx-auto mb-4 text-primary" />
          <h1 className="text-xl font-black">Dashboard access unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-white/62">
            {profileError || "Your login worked, but this account does not have a staff/admin profile yet."}
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button type="button" onClick={() => window.location.reload()} className="bg-primary font-bold text-black hover:bg-primary/90">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button asChild variant="outline" className="border-white/15 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white">
              <Link to="/pinkd-login">Go to Login</Link>
            </Button>
          </div>
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
