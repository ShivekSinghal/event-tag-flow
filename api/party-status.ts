/**
 * GET /api/party-status
 *
 * Public JSON feed of live party-phase and intensive-seat availability for
 * pinkd.hashtag.dance. Runs as a Vercel serverless function and proxies the
 * `get_event_party_status()` Postgres function, which is the same query the
 * checkout uses to price party entries — so the number shown always matches
 * the number charged.
 *
 * Response shape:
 * {
 *   "party":    { "booked": 23, "held": 4 },
 *   "sessions": { "1": { "booked": 40, "held": 2, "cap": 120, "label": "..." }, "2": {...}, "3": {...}, "4": {...} },
 *   "phase":    { "number": 1, "key": "phase_1", "name": "Phase 1", "price_inr": 2000, "min_party_count": 0,
 *                 "next_price_inr": 2499, "next_min_party_count": 50, "remaining_in_phase": 23, "party_count": 27 },
 *   "generated_at": "2026-09-04T09:00:00Z"
 * }
 */

const FALLBACK_SUPABASE_URL = "https://xdaienqjbybomctsoiro.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkYWllbnFqYnlib21jdHNvaXJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzODQ3ODksImV4cCI6MjA3MTk2MDc4OX0.BPyPSw_mQ3hb7Y4dm7bRSwGzM71TYCTSvIL5SPRcAfk";

type VercelRequestLike = {
  method?: string;
};

type VercelResponseLike = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => VercelResponseLike;
  json: (body: unknown) => void;
  end: (body?: string) => void;
};

function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

export default async function handler(req: VercelRequestLike, res: VercelResponseLike) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = (readEnv("SUPABASE_URL", "VITE_SUPABASE_URL") || FALLBACK_SUPABASE_URL).replace(/\/$/, "");
  const anonKey = readEnv("SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY") || FALLBACK_SUPABASE_ANON_KEY;

  try {
    const upstream = await fetch(`${supabaseUrl}/rest/v1/rpc/get_event_party_status`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    });

    const payload = await upstream.json().catch(() => null);

    if (!upstream.ok || !payload || typeof payload !== "object") {
      res.status(502).json({
        error: "Party status is unavailable",
        details: payload && typeof payload === "object" ? payload : null,
      });
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).json(payload);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Party status is unavailable" });
  }
}
