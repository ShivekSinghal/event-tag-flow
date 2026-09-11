import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import ErrorBoundary from "./components/ErrorBoundary";
import Layout from "./components/layout/Layout";
import Dashboard from "./pages/Dashboard";
import IssueTag from "./pages/IssueTag";
import TopUp from "./pages/TopUp";
import CashBooking from "./pages/CashBooking";
import POS from "./pages/POS";
import Pinkredibles from "./pages/Pinkredibles";
import Balance from "./pages/Balance";
import DonationProgress from "./pages/DonationProgress";
import DareBoard from "./pages/DareBoard";
import ProgressTabs from "./pages/ProgressTabs";
import EventLanding from "./pages/EventLanding";
import CoinsPage from "./pages/CoinsPage";
import AttendeesPage from "./pages/AttendeesPage";
import PolicyPage from "./pages/PolicyPages";
import GameRules from "./pages/GameRules";
import GameRulePage from "./pages/GameRulePage";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<EventLanding />} />
            <Route path="/event" element={<EventLanding />} />
            <Route path="/coins" element={<CoinsPage />} />
            <Route path="/attendees" element={<AttendeesPage />} />
            <Route path="/contact-us" element={<PolicyPage type="contact" />} />
            <Route path="/game-rules" element={<GameRules />} />
            <Route path="/games-rules" element={<GameRules />} />
            <Route path="/games-rules/:gameId" element={<GameRulePage />} />
            <Route path="/terms-and-conditions" element={<PolicyPage type="terms" />} />
            <Route path="/refunds-cancellations" element={<PolicyPage type="refunds" />} />
            <Route path="/pinkd-login" element={<Auth />} />
            <Route path="/auth" element={<Navigate to="/pinkd-login" replace />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={
              <ErrorBoundary title="Dashboard area could not load">
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              </ErrorBoundary>
            }>
              <Route path="dashboard" element={
                <ErrorBoundary title="Dashboard could not load">
                  <ProtectedRoute requiredRole="admin">
                    <Dashboard />
                  </ProtectedRoute>
                </ErrorBoundary>
              } />
              <Route path="issue-tag" element={<IssueTag />} />
              <Route path="topup" element={<TopUp />} />
              <Route path="pos" element={<POS />} />
              <Route path="pinkredibles" element={<Pinkredibles />} />
              <Route path="cash-booking" element={<CashBooking />} />
              <Route path="balance" element={
                <ProtectedRoute requiredRole="admin">
                  <Balance />
                </ProtectedRoute>
              } />
              <Route element={<ProtectedRoute requiredRole="admin"><ProgressTabs /></ProtectedRoute>}>
                <Route path="dare-board" element={<DareBoard />} />
                <Route path="donation-progress" element={<DonationProgress />} />
              </Route>
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
