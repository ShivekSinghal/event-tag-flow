import type { SupabaseClient } from "npm:@supabase/supabase-js@2.56.0";

type SupabaseAdminClient = Pick<SupabaseClient, "from" | "rpc">;

export type CoinCreditOutcome = {
  attempted: boolean;
  credited: number;
  reason: string | null;
  error: string | null;
};

/**
 * After a /coins order is paid, credit the linked band right away. Safe to call
 * for any order: non-coin orders return without touching anything, and the
 * database ledger makes repeated calls (verify + webhook) idempotent.
 */
export async function autoCreditCoinOrder(supabase: SupabaseAdminClient, eventOrderId: string): Promise<CoinCreditOutcome> {
  try {
    const { data: order } = await supabase
      .from("event_orders")
      .select("id, booking_source, parent_order_id")
      .eq("id", eventOrderId)
      .maybeSingle();

    if (!order || order.booking_source !== "coins_page" || !order.parent_order_id) {
      return { attempted: false, credited: 0, reason: null, error: null };
    }

    const { data, error } = await supabase.rpc("auto_credit_coin_order", { p_coin_order_id: eventOrderId });
    if (error) {
      console.error("auto_credit_coin_order failed:", error);
      return { attempted: true, credited: 0, reason: null, error: error.message || "credit failed" };
    }

    return {
      attempted: true,
      credited: Number(data?.credited || 0),
      reason: typeof data?.reason === "string" ? data.reason : null,
      error: null,
    };
  } catch (error) {
    console.error("autoCreditCoinOrder threw:", error);
    return { attempted: true, credited: 0, reason: null, error: error instanceof Error ? error.message : "credit failed" };
  }
}
