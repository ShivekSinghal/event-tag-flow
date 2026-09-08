import { z } from "zod";

const guestSchema = z.object({
  item_id: z.string().uuid(), admission_index: z.number().int().positive(),
  event_number: z.number().int().min(0).max(4), label: z.string(),
  order_id: z.string().uuid(), order_ref: z.string(), package_name: z.string(),
  studio: z.string(), booker_name: z.string(), booker_phone: z.string(), booker_email: z.string(),
  payment_status: z.string(), payment_provider: z.string().nullable(),
  attendee_name: z.string().nullable(), attendee_phone: z.string().nullable(),
  checked_in_at: z.string().datetime({ offset: true }).nullable(), checked_in_by: z.string().nullable(),
});
const reportSchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  studios: z.array(z.object({
    studio: z.string(), event_number: z.number().int().min(0).max(4),
    sold: z.number().int().nonnegative(), checked_in: z.number().int().nonnegative(),
  }).refine(row => row.checked_in <= row.sold)),
  attendees: z.array(guestSchema),
});
export type EventGuest = z.infer<typeof guestSchema>;
export type AdmissionReport = z.infer<typeof reportSchema>;
export function parseAdmissionReport(value: unknown): AdmissionReport {
  const result = reportSchema.safeParse(value);
  if (!result.success) throw new Error("The attendee report is incomplete. Refresh and try again.");
  return result.data;
}
export const eventName = (number: number) => number === 0 ? "Party" : `Intensive ${number}`;
export function filterGuests(guests: EventGuest[], search: string, studio: string, status: string) {
  const query = search.trim().toLocaleLowerCase();
  return guests.filter(guest => (studio === "all" || guest.studio === studio)
    && (status === "all" || Boolean(guest.checked_in_at) === (status === "entered"))
    && (!query || [guest.attendee_name, guest.attendee_phone, guest.booker_name,
      guest.booker_phone, guest.booker_email, guest.order_ref, guest.studio, guest.package_name]
      .some(value => value?.toLocaleLowerCase().includes(query))));
}
