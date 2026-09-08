import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseAdmissionReport } from "@/lib/eventAdmissions";

export function useEventAdmissions(userId: string | undefined, enabled: boolean, eventNumber: number | null) {
  return useQuery({
    queryKey: ["event-admissions", userId, eventNumber],
    enabled: enabled && Boolean(userId),
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      const timer = window.setTimeout(cancel, 12_000);
      try {
        const { data, error } = await supabase.rpc("get_event_admission_report",
          eventNumber === null ? {} : { p_event_number: eventNumber }).abortSignal(controller.signal);
        if (error) throw new Error("Attendee report unavailable. Check your connection, admin access and database migration.");
        return parseAdmissionReport(data);
      } finally {
        window.clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
      }
    },
    refetchInterval: 15_000, refetchIntervalInBackground: false,
    refetchOnWindowFocus: true, refetchOnReconnect: true, retry: false, gcTime: 0,
  });
}
