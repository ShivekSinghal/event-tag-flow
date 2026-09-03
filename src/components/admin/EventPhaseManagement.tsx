import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Save, TicketPercent } from "lucide-react";
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

type EventPackage = Tables<"event_packages">;
type EventPhase = Tables<"event_pricing_phases">;
type EventPhaseLimit = Tables<"event_package_phase_limits">;
type PhaseStats = {
  phase_id: string;
  package_id: string;
  confirmed_quantity: number;
  pending_quantity: number;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

function getCategoryLabel(category: string) {
  return EVENT_CATEGORY_LABELS[category as keyof typeof EVENT_CATEGORY_LABELS] || category;
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function isCurrentPhase(phase: EventPhase) {
  if (!phase.active) return false;
  const now = Date.now();
  const startsAt = phase.starts_at ? new Date(phase.starts_at).getTime() : -Infinity;
  const endsAt = phase.ends_at ? new Date(phase.ends_at).getTime() : Infinity;
  return startsAt <= now && now < endsAt;
}

export default function EventPhaseManagement() {
  const { toast } = useToast();
  const [phases, setPhases] = useState<EventPhase[]>([]);
  const [packages, setPackages] = useState<EventPackage[]>([]);
  const [limits, setLimits] = useState<EventPhaseLimit[]>([]);
  const [stats, setStats] = useState<PhaseStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchPhaseConfig = useCallback(async () => {
    try {
      setIsLoading(true);

      const [phaseResult, packageResult, limitResult, statResult] = await Promise.all([
        supabase.from("event_pricing_phases").select("*").order("display_order", { ascending: true }),
        supabase.from("event_packages").select("*").order("display_order", { ascending: true }),
        supabase.from("event_package_phase_limits").select("*"),
        supabase.rpc("get_event_phase_package_stats"),
      ]);

      if (phaseResult.error) throw phaseResult.error;
      if (packageResult.error) throw packageResult.error;
      if (limitResult.error) throw limitResult.error;
      if (statResult.error) throw statResult.error;

      setPhases(phaseResult.data || []);
      setPackages(packageResult.data || []);
      setLimits(limitResult.data || []);
      setStats((statResult.data || []) as PhaseStats[]);
    } catch (error: unknown) {
      toast({
        title: "Phase Config Load Failed",
        description: getErrorMessage(error) || "Could not load event phase controls.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchPhaseConfig();
  }, [fetchPhaseConfig]);

  const statMap = useMemo(() => {
    const map = new Map<string, PhaseStats>();
    stats.forEach((stat) => map.set(`${stat.phase_id}:${stat.package_id}`, stat));
    return map;
  }, [stats]);

  const updatePhase = (phaseId: string, patch: Partial<EventPhase>) => {
    setPhases((current) => current.map((phase) => (phase.id === phaseId ? { ...phase, ...patch } : phase)));
  };

  const updateLimit = (limitId: string, patch: Partial<EventPhaseLimit>) => {
    setLimits((current) => current.map((limit) => (limit.id === limitId ? { ...limit, ...patch } : limit)));
  };

  const savePhaseConfig = async () => {
    try {
      setIsSaving(true);

      const phaseUpdates = phases.map((phase) =>
        supabase
          .from("event_pricing_phases")
          .update({
            name: phase.name,
            active: phase.active,
            starts_at: phase.starts_at,
            ends_at: phase.ends_at,
            display_order: Number(phase.display_order),
          })
          .eq("id", phase.id),
      );

      const limitUpdates = limits.map((limit) =>
        supabase
          .from("event_package_phase_limits")
          .update({
            active: limit.active,
            capacity: Number(limit.capacity),
            price_inr: Number(limit.price_inr),
          })
          .eq("id", limit.id),
      );

      const results = await Promise.all([...phaseUpdates, ...limitUpdates]);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;

      toast({
        title: "Phase Controls Saved",
        description: "Phase pricing, capacities, and availability are updated.",
      });
      await fetchPhaseConfig();
    } catch (error: unknown) {
      toast({
        title: "Save Failed",
        description: getErrorMessage(error) || "Could not save phase controls.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-8 text-center text-muted-foreground">Loading phase controls...</CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <TicketPercent className="h-5 w-5 text-primary" />
            Event Phase Pricing & Capacity
          </span>
          <Button onClick={savePhaseConfig} disabled={isSaving} size="sm">
            <Save className="mr-2 h-4 w-4" />
            Save Phase Controls
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {phases.map((phase) => {
          const currentPhase = isCurrentPhase(phase);

          return (
            <div key={phase.id} className="rounded-lg border bg-secondary/20 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CalendarClock className="h-5 w-5 text-primary" />
                    <h3 className="text-xl font-bold">{phase.name}</h3>
                    <Badge variant={phase.active ? "default" : "secondary"}>
                      {phase.active ? "Enabled" : "Deactivated"}
                    </Badge>
                    {currentPhase ? <Badge variant="outline">Current live phase</Badge> : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Edit the timer window, prices, capacity, and availability for every package.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={phase.active}
                    onCheckedChange={(checked) => updatePhase(phase.id, { active: checked === true })}
                  />
                  Phase active
                </label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_12rem_12rem_7rem]">
                <div className="space-y-2">
                  <Label>Phase Name</Label>
                  <Input value={phase.name} onChange={(event) => updatePhase(phase.id, { name: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Starts At</Label>
                  <Input
                    type="datetime-local"
                    value={toDateTimeLocal(phase.starts_at)}
                    onChange={(event) => updatePhase(phase.id, { starts_at: fromDateTimeLocal(event.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Ends At</Label>
                  <Input
                    type="datetime-local"
                    value={toDateTimeLocal(phase.ends_at)}
                    onChange={(event) => updatePhase(phase.id, { ends_at: fromDateTimeLocal(event.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Order</Label>
                  <Input
                    type="number"
                    step="1"
                    value={Number(phase.display_order)}
                    onChange={(event) => updatePhase(phase.id, { display_order: Number(event.target.value) })}
                  />
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <div className="min-w-[48rem] rounded-lg border">
                  <div className="grid grid-cols-[1.35fr_7rem_7rem_7rem_6rem_6rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    <span>Package</span>
                    <span>Price</span>
                    <span>Capacity</span>
                    <span>Sold</span>
                    <span>Held</span>
                    <span>Active</span>
                  </div>
                  {packages.map((eventPackage) => {
                    const limit = limits.find(
                      (phaseLimit) => phaseLimit.phase_id === phase.id && phaseLimit.package_id === eventPackage.id,
                    );
                    if (!limit) return null;

                    const stat = statMap.get(`${phase.id}:${eventPackage.id}`);
                    const confirmed = Number(stat?.confirmed_quantity || 0);
                    const pending = Number(stat?.pending_quantity || 0);
                    const heldRemaining = Math.max(Number(limit.capacity || 0) - confirmed - pending, 0);

                    return (
                      <div
                        key={limit.id}
                        className="grid grid-cols-[1.35fr_7rem_7rem_7rem_6rem_6rem] items-center gap-3 border-b px-3 py-3 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{eventPackage.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {getCategoryLabel(eventPackage.category)} · Base {formatEventPrice(eventPackage.price_inr)}
                          </div>
                        </div>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={Number(limit.price_inr)}
                          onChange={(event) => updateLimit(limit.id, { price_inr: Number(event.target.value) })}
                        />
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={Number(limit.capacity)}
                          onChange={(event) => updateLimit(limit.id, { capacity: Number(event.target.value) })}
                        />
                        <div className="text-sm">
                          <div className="font-bold">{confirmed} / {limit.capacity}</div>
                          <div className="text-xs text-muted-foreground">{heldRemaining} left</div>
                        </div>
                        <div className="text-sm">
                          <div className="font-bold">{pending}</div>
                          <div className="text-xs text-muted-foreground">temporary holds</div>
                        </div>
                        <Checkbox
                          checked={limit.active}
                          onCheckedChange={(checked) => updateLimit(limit.id, { active: checked === true })}
                          aria-label={`${eventPackage.name} active in ${phase.name}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
