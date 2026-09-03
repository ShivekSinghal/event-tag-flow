import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Route render failed:", error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050307] p-4 text-white">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#111015] p-6 text-center shadow-[0_30px_90px_-40px_rgba(255,0,127,0.85)]">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/15">
            <AlertTriangle className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-4 text-xl font-black">{this.props.title || "Dashboard could not load"}</h1>
          <p className="mt-2 text-sm leading-6 text-white/62">
            The app hit a display error instead of loading the dashboard. Refresh the page, or go back to login and open the dashboard again.
          </p>
          <p className="mt-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/45">
            {this.state.error.message}
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button type="button" onClick={() => window.location.reload()} className="bg-primary font-bold text-black hover:bg-primary/90">
              <RefreshCcw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button asChild type="button" variant="outline" className="border-white/15 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white">
              <Link to="/pinkd-login">Go to Login</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
