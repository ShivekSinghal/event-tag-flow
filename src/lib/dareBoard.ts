import { z } from 'zod';

export const DARE_MILESTONES = [10000, 25000, 50000, 75000, 100000, 150000, 200000, 300000, 400000, 500000, 1000000] as const;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const contributionSchema = z.object({
  transaction_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  first_name: z.string().min(1).max(40),
  studio: z.string().max(80).nullable(),
  item_name: z.string().max(120),
  coins: count.positive(),
  source: z.enum(['tier_1', 'food', 'bar']),
});
export type DareContribution = z.infer<typeof contributionSchema>;
export const dareProgressSchema = z.object({
  total_coins: count,
  tier_1_coins: count,
  food_coins: count,
  bar_coins: count,
  counted_sales: count,
  milestone_pickers: z.array(contributionSchema.extend({ milestone: count.refine(value => DARE_MILESTONES.some(m => m === value)) })).max(11),
  recent_transactions: z.array(contributionSchema.extend({ voided: z.boolean() })).max(20),
  latest_transactions: z.array(contributionSchema.extend({ voided: z.boolean() })).max(3),
  log_has_more: z.boolean(),
  as_of: z.string().datetime({ offset: true }),
}).refine(value => value.total_coins === value.tier_1_coins + value.food_coins + value.bar_coins)
  .refine(value => {
    const reached = DARE_MILESTONES.filter(m => m <= value.total_coins);
    return reached.length === value.milestone_pickers.length && reached.every(m => value.milestone_pickers.filter(p => p.milestone === m).length === 1);
  });
export type DareProgress = z.infer<typeof dareProgressSchema>;
export const dareNumber = (value: number) => value.toLocaleString('en-IN');
export const dareTime = (value: string) => new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function dareCheckpoint(total: number) {
  const completed = DARE_MILESTONES.filter(value => total >= value).length;
  const previous = DARE_MILESTONES[completed - 1] ?? 0;
  const next = DARE_MILESTONES[completed];
  return {
    completed, next, previous,
    remaining: next === undefined ? 0 : Math.max(0, next - total),
    percent: next === undefined ? 100 : Math.min(100, Math.max(0, (total - previous) / (next - previous) * 100)),
  };
}

export function crossedDares(previous: number, current: number) {
  return DARE_MILESTONES.filter(value => value > previous && value <= current);
}
