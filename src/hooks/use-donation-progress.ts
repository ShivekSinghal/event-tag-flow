import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DONATION_POLL_MS, parseDonationSnapshot, type DonationSnapshot } from "@/lib/donationProgress";

export function useDonationProgress(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<DonationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, running = false, dirty = false;
    let controller: AbortController | null = null;
    const fetchSnapshot = async () => {
      if (stopped || document.hidden) return;
      if (running) { dirty = true; return; }
      running = true;
      setLoading(true);
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10_000);
      try {
        const { data, error: fetchError } = await supabase.rpc("get_donation_collection_progress").abortSignal(controller.signal);
        if (fetchError) throw fetchError;
        const parsed = parseDonationSnapshot(data);
        if (!stopped) { setSnapshot(parsed); setError(null); }
      } catch {
        if (!stopped) setError("Updates paused. Last confirmed total is retained. Please retry.");
      } finally {
        window.clearTimeout(timeout);
        running = false;
        if (!stopped) {
          setLoading(false);
          if (dirty) { dirty = false; void fetchSnapshot(); }
        }
      }
    };
    const reload = () => { void fetchSnapshot(); };
    refresh.current = reload;
    reload();
    const poll = window.setInterval(reload, DONATION_POLL_MS);
    document.addEventListener("visibilitychange", reload);
    window.addEventListener("online", reload);
    // Events invalidate the absolute snapshot; they never increment money directly.
    const channel = supabase.channel("donation-collections")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_orders" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_order_items" }, reload)
      .subscribe(status => {
        if (stopped) return;
        setLive(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") reload();
      });
    return () => {
      stopped = true;
      controller?.abort();
      refresh.current = () => {};
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", reload);
      window.removeEventListener("online", reload);
      void supabase.removeChannel(channel);
    };
  }, [enabled]);
  return { snapshot, error, loading, live, refresh: () => refresh.current() };
}
