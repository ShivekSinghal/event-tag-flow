export type WalletOperationKind = "spend" | "topup";

export type WalletOperationRequest = {
  kind: WalletOperationKind;
  wallet_id: string;
  coin_amount?: number;
  transaction_type?: string;
  item_name?: string;
  item_category?: string;
  game_id?: string | null;
  reference: string;
  coin_package_id?: string;
  expected_coin_amount?: number;
  expected_inr_amount?: number;
};

export type PendingWalletOperation = {
  version: 1;
  id: string;
  operator: string;
  request: WalletOperationRequest;
};

export type WalletOperationResult = {
  status: "succeeded" | "rejected";
  message?: string;
  transaction_id?: string;
  new_coin_balance?: number;
  credited_coin_amount?: number;
  spent_coin_amount?: number;
  inr_amount?: number;
};

const prefix = "pinkd.wallet-operation.v1:";

export function readWalletOperation(storage: Storage, operator: string): PendingWalletOperation | null {
  const raw = storage.getItem(prefix + operator);
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingWalletOperation;
  if (value.version !== 1 || value.operator !== operator || !value.id || !value.request?.wallet_id
    || !["spend", "topup"].includes(value.request.kind)) {
    throw new Error("Saved payment could not be read. Ask an admin to reconcile it before continuing.");
  }
  return value;
}

export function saveWalletOperation(storage: Storage, operation: PendingWalletOperation) {
  storage.setItem(prefix + operation.operator, JSON.stringify(operation));
}

export function clearWalletOperation(storage: Storage, operation: PendingWalletOperation) {
  if (readWalletOperation(storage, operation.operator)?.id === operation.id) {
    storage.removeItem(prefix + operation.operator);
  }
}

export function parseWalletOperationResult(value: unknown): WalletOperationResult {
  if (!value || typeof value !== "object") throw new Error("Payment response was incomplete.");
  const result = value as WalletOperationResult;
  if (result.status !== "succeeded" && result.status !== "rejected") throw new Error("Payment response was incomplete.");
  if (result.status === "succeeded" && (!result.transaction_id || !Number.isFinite(result.new_coin_balance))) {
    throw new Error("Payment receipt was incomplete.");
  }
  return result;
}
