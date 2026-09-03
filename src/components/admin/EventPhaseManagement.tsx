import { useState } from "react";
import { AlertTriangle, RefreshCw, TicketPercent, Timer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatEventPrice } from "@/lib/eventPackages";
import { getSessionAvailability, usePartyStatus } from "@/lib/partyStatus";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Read-only view of the automatic party phase and per-session seat capacity.
 * Phases are computed server-side from paid + held party entries and ratchet
 * forward only; admins cannot edit them (UPDATE is revoked in the database).
 */

const PHASE_LADDER = [
  { number: 1, name: "Phase 1", priceInr: 2000, spots: "spots 1–50" },
  { number: 2, name: "Phase 2", priceInr: 2499, spots: "spots 51–150" },
  { number: 3, name: "Phase 3", priceInr: 2999, spots: "151+" },
];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : undefined;
}

export default function EventPhaseManagement() {
  const { toast } = useToast();
  const { status, isLive, lastError, refresh } = usePartyStatus();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExpiring, setIsExpiring] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExpireStaleHolds = async () => {
    try {
      setIsExpiring(true);
      const { data, error } = await supabase.rpc("expire_stale_event_orders");
      if (error) throw error;
      const cancelled = Number(data ?? 0);
      toast({
        title: "Stale Holds Expired",
        description: `Cancelled ${cancelled} abandoned checkout${cancelled === 1 ? "" : "s"}`,
      });
      await refresh();
    } catch (error: unknown) {
      toast({
        title: "Expire Failed",
        description: getErrorMessage(error) || "Could not expire stale checkouts.",
        variant: "destructive",
      });
    } finally {
      setIsExpiring(false);
    }
  };

  const phase = status?.phase ?? null;
  const partyBooked = status?.party.booked ?? 0;
  const partyHeld = status?.party.held ?? 0;
  const partyCount = phase?.party_count ?? partyBooked + partyHeld;
  const currentPhaseNumber = phase?.number ?? 1;
  const sessions = getSessionAvailability(status);

  const nextPhase = phase?.next_price_inr !== null && phase?.next_price_inr !== undefined
    ? PHASE_LADDER.find((row) => row.number === currentPhaseNumber + 1) ?? null
    : null;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2">
            <TicketPercent className="h-5 w-5 text-primary" />
            Party Phase & Seat Capacity (automatic)
          </span>
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={`mr-2 h-4 w-4${isRefreshing ? " animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExpireStaleHolds} disabled={isExpiring}>
              <Timer className="mr-2 h-4 w-4" />
              Expire stale holds
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current phase */}
        <div className="rounded-lg border bg-secondary/20 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span
                  aria-label={isLive ? "Live" : "Offline"}
                  title={isLive ? "Live status connected" : "Live status unavailable"}
                  className={`inline-block h-2.5 w-2.5 rounded-full ${isLive ? "bg-success" : "bg-muted-foreground/50"}`}
                />
                {isLive ? "Live" : "Not live"}
              </div>
              <h3 className="text-xl font-bold">
                {phase ? `${phase.name} · ${formatEventPrice(phase.price_inr)} per party entry` : "Loading phase..."}
              </h3>
              <p className="text-sm text-muted-foreground">
                {phase
                  ? phase.next_price_inr === null || phase.remaining_in_phase === null
                    ? "Final phase"
                    : `${phase.remaining_in_phase} spots left before ${nextPhase?.name ?? `Phase ${currentPhaseNumber + 1}`} (${formatEventPrice(phase.next_price_inr)})`
                  : "Waiting for live status."}
              </p>
            </div>
            <div className="text-sm sm:text-right">
              <div className="text-2xl font-bold">{partyCount}</div>
              <div className="text-muted-foreground">party entries counted</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {partyBooked} paid · {partyHeld} held
              </div>
            </div>
          </div>
          {lastError ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{lastError}</span>
            </div>
          ) : null}
        </div>

        {/* Ladder */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Phase Ladder</h3>
          <div className="rounded-lg border">
            {PHASE_LADDER.map((row) => {
              const isCurrent = row.number === currentPhaseNumber;
              const isPast = row.number < currentPhaseNumber;
              return (
                <div
                  key={row.number}
                  className={`flex items-center justify-between gap-3 border-b px-3 py-3 last:border-b-0 ${
                    isCurrent ? "bg-primary/10" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`font-semibold ${isPast ? "text-muted-foreground line-through" : ""}`}>{row.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatEventPrice(row.priceInr)} · {row.spots}
                    </span>
                  </div>
                  {isCurrent ? <Badge>Current</Badge> : isPast ? <Badge variant="outline">Passed</Badge> : null}
                </div>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            Phases are computed from paid + held party entries and only move forward. Nobody sets them by hand. Full
            Pass and crew prices are flat.
          </p>
        </section>

        {/* Sessions */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Intensive Sessions</h3>
          <div className="overflow-x-auto">
            <div className="min-w-[40rem] rounded-lg border">
              <div className="grid grid-cols-[1.5fr_6rem_6rem_6rem_6rem_8rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <span>Session</span>
                <span>Booked</span>
                <span>Held</span>
                <span>Cap</span>
                <span>Remaining</span>
                <span>Status</span>
              </div>
              {sessions.map((session) => {
                const raw = status?.sessions[session.key];
                return (
                  <div
                    key={session.key}
                    className="grid grid-cols-[1.5fr_6rem_6rem_6rem_6rem_8rem] items-center gap-3 border-b px-3 py-3 text-sm last:border-b-0"
                  >
                    <span className="truncate font-semibold">{session.label}</span>
                    <span>{raw?.booked ?? 0}</span>
                    <span>{raw?.held ?? 0}</span>
                    <span>{session.cap}</span>
                    <span className="font-bold">{session.remaining}</span>
                    <span>
                      {session.soldOut ? (
                        <Badge variant="destructive">Sold out</Badge>
                      ) : session.warning ? (
                        <Badge variant="secondary">Filling up</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Open</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
