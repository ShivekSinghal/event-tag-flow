import { useCallback, useEffect, useState } from "react";
import { CreditCard, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PaymentGatewaySetting = Tables<"payment_gateway_settings">;
type PaymentProvider = "cashfree" | "razorpay";
type CashfreeMode = "sandbox" | "production";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

function isRazorpayKeyId(value: string) {
  return /^rzp_(test|live)_[A-Za-z0-9]+$/.test(value.trim());
}

export default function PaymentGatewaySettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<PaymentGatewaySetting | null>(null);
  const [activeProvider, setActiveProvider] = useState<PaymentProvider>("cashfree");
  const [cashfreeMode, setCashfreeMode] = useState<CashfreeMode>("sandbox");
  const [razorpayKeyId, setRazorpayKeyId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("payment_gateway_settings")
        .select("*")
        .eq("id", "event_bookings")
        .single();

      if (error) throw error;

      setSettings(data);
      setActiveProvider(data.active_provider === "razorpay" ? "razorpay" : "cashfree");
      setCashfreeMode(data.cashfree_mode === "production" ? "production" : "sandbox");
      setRazorpayKeyId(data.razorpay_key_id || "");
    } catch (error: unknown) {
      toast({
        title: "Payment Settings Failed",
        description: getErrorMessage(error) || "Could not load event payment gateway settings.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = async () => {
    try {
      if (activeProvider === "razorpay" && !isRazorpayKeyId(razorpayKeyId)) {
        toast({
          title: "Invalid Razorpay Key",
          description: "Razorpay Key ID must start with rzp_live_ or rzp_test_. Cashfree secrets should be saved only in Supabase Edge Function secrets.",
          variant: "destructive",
        });
        return;
      }

      setIsSaving(true);
      const { error } = await supabase
        .from("payment_gateway_settings")
        .update({
          active_provider: activeProvider,
          cashfree_mode: cashfreeMode,
          razorpay_key_id: razorpayKeyId.trim() || null,
        })
        .eq("id", "event_bookings");

      if (error) throw error;

      toast({
        title: "Payment Gateway Updated",
        description:
          activeProvider === "cashfree"
            ? `Event bookings now use Cashfree ${cashfreeMode}.`
            : "Event bookings now use Razorpay.",
      });
      await fetchSettings();
    } catch (error: unknown) {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error) || "Could not update payment gateway.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Universal Event Payment Gateway
          </span>
          {settings ? (
            <Badge variant="outline">
              Active: {settings.active_provider === "razorpay" ? "Razorpay" : "Cashfree"}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end">
        <div className="space-y-2">
          <Label>Gateway for Landing Page Checkout</Label>
          <Select
            value={activeProvider}
            onValueChange={(value) => setActiveProvider(value as PaymentProvider)}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select payment gateway" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cashfree">Cashfree</SelectItem>
              <SelectItem value="razorpay">Razorpay</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            This switch controls all new event booking payments. Existing orders keep their original payment provider.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Cashfree Mode</Label>
          <Select
            value={cashfreeMode}
            onValueChange={(value) => setCashfreeMode(value as CashfreeMode)}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select Cashfree mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="production">Production</SelectItem>
              <SelectItem value="sandbox">Sandbox</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Production uses Cashfree live APIs. Credentials still stay in Supabase Edge Function secrets.
          </p>
          <p className="text-xs text-muted-foreground">
            Required secrets: CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Razorpay Key ID</Label>
          <Input
            value={razorpayKeyId}
            onChange={(event) => setRazorpayKeyId(event.target.value)}
            placeholder="rzp_live_..."
            disabled={isLoading}
          />
          <p className="text-sm text-muted-foreground">
            Public checkout key only. Keep the Razorpay secret in Supabase Edge Function secrets.
          </p>
          {razorpayKeyId.trim().startsWith("cf") ? (
            <p className="text-xs font-medium text-destructive">
              This looks like a Cashfree key. Razorpay Key ID should start with rzp_live_ or rzp_test_.
            </p>
          ) : null}
        </div>
        <Button onClick={saveSettings} disabled={isLoading || isSaving}>
          <Save className="mr-2 h-4 w-4" />
          Save Gateway
        </Button>
      </CardContent>
    </Card>
  );
}
