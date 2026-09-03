import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EVENT_TIME_SLOTS } from "@/lib/eventPackages";

/**
 * Live party-phase and intensive-seat availability.
 *
 * Source of truth is the `get_event_party_status()` SQL function, which is
 * served publicly as `GET /api/party-status` (JSON, Cache-Control: no-store).
 * The page polls it every 45 s and again when the tab regains focus. Displayed
 * numbers ratchet: they never go down even if a checkout hold expires.
 */

export const PARTY_STATUS_ENDPOINT = "/api/party-status";
export const PARTY_STATUS_POLL_MS = 45_000;
export const SESSION_SEAT_CAP = 120;
export const SESSION_WARNING_RATIO = 0.7;

export type SessionStatus = {
  booked: number;
  held: number;
  cap: number;
  label: string;
};

export type PartyPhaseStatus = {
  number: number;
  key: string;
  name: string;
  price_inr: number;
  min_party_count: number;
  next_price_inr: number | null;
  next_min_party_count: number | null;
  remaining_in_phase: number | null;
  party_count: number;
};

export type PartyStatus = {
  party: { booked: number; held: number };
  sessions: Record<string, SessionStatus>;
  phase: PartyPhaseStatus;
  generated_at?: string;
};

function toNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizePartyStatus(raw: unknown): PartyStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as Record<string, unknown>;
  const party = (payload.party || {}) as Record<string, unknown>;
  const phase = (payload.phase || {}) as Record<string, unknown>;
  const rawSessions = (payload.sessions || {}) as Record<string, Record<string, unknown>>;

  const sessions: Record<string, SessionStatus> = {};
  EVENT_TIME_SLOTS.forEach((label, index) => {
    const key = String(index + 1);
    const session = rawSessions[key] || {};
    sessions[key] = {
      booked: toNumber(session.booked),
      held: toNumber(session.held),
      cap: toNumber(session.cap, SESSION_SEAT_CAP),
      label: typeof session.label === "string" ? session.label : label,
    };
  });

  const partyBooked = toNumber(party.booked);
  const partyHeld = toNumber(party.held);

  return {
    party: { booked: partyBooked, held: partyHeld },
    sessions,
    phase: {
      number: toNumber(phase.number, 1),
      key: typeof phase.key === "string" ? phase.key : "phase_1",
      name: typeof phase.name === "string" ? phase.name : "Phase 1",
      price_inr: toNumber(phase.price_inr, 2000),
      min_party_count: toNumber(phase.min_party_count, 0),
      next_price_inr: toNullableNumber(phase.next_price_inr),
      next_min_party_count: toNullableNumber(phase.next_min_party_count),
      remaining_in_phase: toNullableNumber(phase.remaining_in_phase),
      party_count: toNumber(phase.party_count, partyBooked + partyHeld),
    },
    generated_at: typeof payload.generated_at === "string" ? payload.generated_at : undefined,
  };
}

export async function fetchPartyStatus(): Promise<PartyStatus> {
  try {
    const response = await fetch(`${PARTY_STATUS_ENDPOINT}?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.includes("application/json")) {
      const normalized = normalizePartyStatus(await response.json());
      if (normalized) return normalized;
    }
  } catch {
    // Fall through to the direct RPC (local dev, or the edge route is down).
  }

  const { data, error } = await supabase.rpc("get_event_party_status");
  if (error) throw error;
  const normalized = normalizePartyStatus(data);
  if (!normalized) throw new Error("Party status payload was empty");
  return normalized;
}

/** Ratchet: keep the larger of the previous and next numbers so the meter never moves backwards. */
export function ratchetPartyStatus(previous: PartyStatus | null, next: PartyStatus): PartyStatus {
  if (!previous) return next;

  const sessions: Record<string, SessionStatus> = {};
  Object.entries(next.sessions).forEach(([key, session]) => {
    const before = previous.sessions[key];
    const nextTaken = session.booked + session.held;
    const prevTaken = before ? before.booked + before.held : 0;
    sessions[key] = nextTaken >= prevTaken
      ? session
      : { ...session, booked: before.booked, held: before.held };
  });

  const nextParty = next.party.booked + next.party.held;
  const prevParty = previous.party.booked + previous.party.held;
  const phase = next.phase.number >= previous.phase.number ? next.phase : previous.phase;

  return {
    ...next,
    party: nextParty >= prevParty ? next.party : previous.party,
    sessions,
    phase: {
      ...phase,
      party_count: Math.max(next.phase.party_count, previous.phase.party_count),
      remaining_in_phase:
        phase.remaining_in_phase === null
          ? null
          : Math.min(phase.remaining_in_phase, previous.phase.remaining_in_phase ?? Number.POSITIVE_INFINITY),
    },
  };
}

export type SessionAvailability = {
  key: string;
  label: string;
  taken: number;
  cap: number;
  remaining: number;
  soldOut: boolean;
  warning: boolean;
};

export function getSessionAvailability(status: PartyStatus | null): SessionAvailability[] {
  return EVENT_TIME_SLOTS.map((label, index) => {
    const key = String(index + 1);
    const session = status?.sessions[key];
    const cap = session?.cap ?? SESSION_SEAT_CAP;
    const taken = session ? session.booked + session.held : 0;
    const remaining = Math.max(cap - taken, 0);
    return {
      key,
      label: session?.label || label,
      taken,
      cap,
      remaining,
      soldOut: Boolean(status) && remaining <= 0,
      warning: Boolean(status) && remaining > 0 && taken >= cap * SESSION_WARNING_RATIO,
    };
  });
}

export function usePartyStatus(options: { enabled?: boolean; pollMs?: number } = {}) {
  const enabled = options.enabled ?? true;
  const pollMs = options.pollMs ?? PARTY_STATUS_POLL_MS;
  const [status, setStatus] = useState<PartyStatus | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const statusRef = useRef<PartyStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchPartyStatus();
      const merged = ratchetPartyStatus(statusRef.current, next);
      statusRef.current = merged;
      setStatus(merged);
      setIsLive(true);
      setLastError(null);
    } catch (error) {
      setIsLive(false);
      setLastError(error instanceof Error ? error.message : "Live status unavailable");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    refresh();
    const interval = window.setInterval(refresh, pollMs);
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, pollMs, refresh]);

  return { status, isLive, lastError, refresh };
}
