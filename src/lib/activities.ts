export const activityGroups = [
  { value: "tier_1", label: "Tier 1" },
  { value: "tier_2", label: "Tier 2" },
  { value: "tier_3", label: "Tier 3" },
  { value: "free", label: "Free" },
  { value: "donations", label: "Donations" },
  { value: "other", label: "Other activities" },
] as const;

export const pricingModes = ["fixed", "free", "donation"] as const;

export function parseDonationCoins(input: string, minimum: number): number | null {
  if (!/^\d+$/.test(input.trim())) return null;
  const amount = Number(input);
  return Number.isSafeInteger(amount) && amount >= Math.max(150, minimum) && amount <= 2147483647
    ? amount : null;
}
