import { z } from "zod";

export const LIVE_SALES_POLL_MS = 15_000;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const liveSalesSchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  sessions: z.array(z.object({
    session_number: count.min(1).max(4),
    label: z.string().min(1),
    sold: count,
    on_hold: count,
    capacity: count,
    available: count,
  })).max(4),
  party: z.object({ sold: count, on_hold: count }),
  totals: z.object({
    intensive_admissions: count,
    party_admissions: count,
    total_admissions: count,
    paid_orders: count,
    event_revenue_inr: z.number().finite().nonnegative(),
  }),
  warnings: z.object({
    session_assignment_items: count,
    unknown_package_items: count,
    pax_items: count,
    incomplete_session_catalog: z.boolean(),
  }),
}).refine((report) => {
  const intensiveAdmissions = report.sessions.reduce((sum, session) => sum + session.sold, 0);
  return new Set(report.sessions.map((session) => session.session_number)).size === report.sessions.length
    && (report.sessions.length === 4 || report.warnings.incomplete_session_catalog)
    && report.sessions.every((session) => session.available === Math.max(session.capacity - session.sold - session.on_hold, 0))
    && report.totals.intensive_admissions === intensiveAdmissions
    && report.totals.party_admissions === report.party.sold
    && report.totals.total_admissions === intensiveAdmissions + report.party.sold;
});

export type EventLiveSales = z.infer<typeof liveSalesSchema>;

export function parseEventLiveSales(value: unknown): EventLiveSales {
  const result = liveSalesSchema.safeParse(value);
  if (!result.success) throw new Error("The sales report returned incomplete or inconsistent data. Please refresh.");
  return result.data;
}
