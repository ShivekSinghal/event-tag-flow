export const COIN_LABEL = "Pink'd Coins";
export const LOW_COIN_BALANCE_THRESHOLD = 50;

export function toIntegerCoins(value: unknown): number {
  if (typeof value === "number") return Math.round(value);
  if (typeof value === "string") return Math.round(Number(value) || 0);
  return 0;
}

export function getCoinBalance(wallet: { coin_balance?: number | string | null; balance?: number | string | null }): number {
  return toIntegerCoins(wallet.coin_balance ?? wallet.balance ?? 0);
}

export function getCoinAmount(transaction: { coin_amount?: number | string | null; amount?: number | string | null }): number {
  return toIntegerCoins(transaction.coin_amount ?? transaction.amount ?? 0);
}

export function formatCoins(value: unknown): string {
  return `${toIntegerCoins(value).toLocaleString("en-IN")} Pink'd Coins`;
}

export function formatInr(value: unknown): string {
  const amount = typeof value === "number" ? value : Number(value || 0);
  return `₹${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
