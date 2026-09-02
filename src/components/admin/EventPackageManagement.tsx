import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarCheck, PackageCheck, Save, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { EVENT_CATEGORY_LABELS, formatEventPrice } from "@/lib/eventPackages";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EventPackage = Tables<"event_packages">;
type EventOrderItem = Pick<Tables<"event_order_items">, "package_key" | "quantity" | "line_total_inr">;
type EventOrderForStats = Pick<Tables<"event_orders">, "payment_status"> & {
  event_order_items: EventOrderItem[] | null;
};

const SUCCESS_STATUSES = new Set(["paid", "completed"]);
const PENDING_STATUSES = new Set(["pending", "manual_payment"]);

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

function getCategoryLabel(category: string) {
  return EVENT_CATEGORY_LABELS[category as keyof typeof EVENT_CATEGORY_LABELS] || category;
}

export default function EventPackageManagement() {
  const { toast } = useToast();
  const [packages, setPackages] = useState<EventPackage[]>([]);
  const [orders, setOrders] = useState<EventOrderForStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchPackagesAndSales = useCallback(async () => {
    try {
      setIsLoading(true);

      const [packageResult, orderResult] = await Promise.all([
        supabase.from("event_packages").select("*").order("display_order", { ascending: true }),
        supabase
          .from("event_orders")
          .select("payment_status, event_order_items(package_key, quantity, line_total_inr)")
          .order("created_at", { ascending: false }),
      ]);

      if (packageResult.error) throw packageResult.error;
      if (orderResult.error) throw orderResult.error;

      setPackages(packageResult.data || []);
      setOrders((orderResult.data || []) as EventOrderForStats[]);
    } catch (error: unknown) {
      toast({
        title: "Event Package Load Failed",
        description: getErrorMessage(error) || "Could not load event package controls.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPackagesAndSales();
  }, [fetchPackagesAndSales]);

  const packageStats = useMemo(() => {
    const stats = new Map<
      string,
      {
        soldQuantity: number;
        pendingQuantity: number;
        successfulRevenue: number;
        bookedValue: number;
      }
    >();

    orders.forEach((order) => {
      const status = order.payment_status || "pending";
      const isSuccessful = SUCCESS_STATUSES.has(status);
      const isPending = PENDING_STATUSES.has(status);

      (order.event_order_items || []).forEach((item) => {
        const current = stats.get(item.package_key) || {
          soldQuantity: 0,
          pendingQuantity: 0,
          successfulRevenue: 0,
          bookedValue: 0,
        };

        current.bookedValue += Number(item.line_total_inr || 0);
        if (isSuccessful) {
          current.soldQuantity += Number(item.quantity || 0);
          current.successfulRevenue += Number(item.line_total_inr || 0);
        } else if (isPending) {
          current.pendingQuantity += Number(item.quantity || 0);
        }

        stats.set(item.package_key, current);
      });
    });

    return stats;
  }, [orders]);

  const totals = useMemo(() => {
    return Array.from(packageStats.values()).reduce(
      (sum, stat) => ({
        soldQuantity: sum.soldQuantity + stat.soldQuantity,
        pendingQuantity: sum.pendingQuantity + stat.pendingQuantity,
        successfulRevenue: sum.successfulRevenue + stat.successfulRevenue,
      }),
      { soldQuantity: 0, pendingQuantity: 0, successfulRevenue: 0 },
    );
  }, [packageStats]);

  const updatePackage = (packageId: string, patch: Partial<EventPackage>) => {
    setPackages((current) =>
      current.map((eventPackage) => (eventPackage.id === packageId ? { ...eventPackage, ...patch } : eventPackage)),
    );
  };

  const savePackages = async () => {
    try {
      setIsSaving(true);

      const updates = packages.map((eventPackage) =>
        supabase
          .from("event_packages")
          .update({
            description: eventPackage.description,
            price_inr: Number(eventPackage.price_inr),
            intensive_count: eventPackage.intensive_count,
            active: eventPackage.active,
            display_order: Number(eventPackage.display_order),
          })
          .eq("id", eventPackage.id),
      );

      const results = await Promise.all(updates);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;

      toast({
        title: "Event Packages Saved",
        description: "Landing page prices and availability are updated.",
      });
      await fetchPackagesAndSales();
    } catch (error: unknown) {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error) || "Could not save event package controls.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-8 text-center text-muted-foreground">Loading event package controls...</CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" />
            Event Package Sales & Controls
          </span>
          <Button onClick={savePackages} disabled={isSaving} size="sm">
            <Save className="mr-2 h-4 w-4" />
            Save Package Controls
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-secondary/30 p-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Packages Sold</span>
              <Ticket className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold">{totals.soldQuantity}</div>
          </div>
          <div className="rounded-lg border bg-secondary/30 p-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Pending Packages</span>
              <CalendarCheck className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold">{totals.pendingQuantity}</div>
          </div>
          <div className="rounded-lg border bg-secondary/30 p-4">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Confirmed INR Revenue</span>
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 text-2xl font-bold">{formatEventPrice(totals.successfulRevenue)}</div>
          </div>
        </div>

        <div className="grid gap-4">
          {packages.map((eventPackage) => {
            const stats = packageStats.get(eventPackage.id) || {
              soldQuantity: 0,
              pendingQuantity: 0,
              successfulRevenue: 0,
              bookedValue: 0,
            };

            return (
              <div key={eventPackage.id} className="rounded-lg border bg-secondary/20 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold">{eventPackage.name}</h3>
                      <Badge variant="outline">{getCategoryLabel(eventPackage.category)}</Badge>
                      <Badge variant={eventPackage.active ? "default" : "secondary"}>
                        {eventPackage.active ? "Active" : "Unavailable"}
                      </Badge>
                    </div>
                    <div className="grid gap-3 text-sm sm:grid-cols-4">
                      <span>Sold: <strong>{stats.soldQuantity}</strong></span>
                      <span>Pending: <strong>{stats.pendingQuantity}</strong></span>
                      <span>Revenue: <strong>{formatEventPrice(stats.successfulRevenue)}</strong></span>
                      <span>Booked Value: <strong>{formatEventPrice(stats.bookedValue)}</strong></span>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={eventPackage.active}
                      onCheckedChange={(checked) => updatePackage(eventPackage.id, { active: checked === true })}
                    />
                    Available on landing page
                  </label>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_8rem_8rem_8rem]">
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={eventPackage.description}
                      onChange={(event) => updatePackage(eventPackage.id, { description: event.target.value })}
                      className="min-h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Price INR</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={Number(eventPackage.price_inr)}
                      onChange={(event) => updatePackage(eventPackage.id, { price_inr: Number(event.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Intensives</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={eventPackage.intensive_count ?? 0}
                      onChange={(event) =>
                        updatePackage(eventPackage.id, {
                          intensive_count: Number(event.target.value) > 0 ? Number(event.target.value) : null,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Display Order</Label>
                    <Input
                      type="number"
                      step="1"
                      value={Number(eventPackage.display_order)}
                      onChange={(event) => updatePackage(eventPackage.id, { display_order: Number(event.target.value) })}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
