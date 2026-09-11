import { z } from "zod";
export const DONATION_GOAL_INR = 1_000_000;
export const DONATION_POLL_MS = 15_000;
const schema = z.object({
  total_inr: z.number().finite().nonnegative(),
  goal_inr: z.literal(DONATION_GOAL_INR),
  collection_count: z.number().int().nonnegative(),
  unpriced_topups: z.number().int().nonnegative(),
  generated_at: z.string().datetime({ offset: true }),
});
export type DonationSnapshot = z.infer<typeof schema>;
export function parseDonationSnapshot(value: unknown): DonationSnapshot {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("Collection data is unavailable or incomplete.");
  return result.data;
}
export function contributionTier(amount: number) {
  return amount >= 10_000 ? "celebration" : amount >= 2_500 ? "ripple" : "standard";
}
export const formatCollection = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
