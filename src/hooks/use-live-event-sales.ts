import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LIVE_SALES_POLL_MS, parseEventLiveSales } from "@/lib/eventLiveSales";

export function useLiveEventSales(userId: string | undefined, enabled: boolean) {
  const [isVisible, setIsVisible] = useState(() => document.visibilityState === "visible");

  useEffect(() => {
    const onVisibilityChange = () => setIsVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  return useQuery({
    queryKey: ["event-live-sales", userId],
    enabled: enabled && Boolean(userId) && isVisible,
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      const timeout = window.setTimeout(cancel, 12_000);
      try {
        const { data, error } = await supabase.rpc("get_event_live_sales").abortSignal(controller.signal);
        if (error) throw new Error("Could not refresh live sales. Check your connection and admin access, then retry.");
        return parseEventLiveSales(data);
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
      }
    },
    refetchInterval: isVisible ? LIVE_SALES_POLL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}
