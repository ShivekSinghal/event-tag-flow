export type WalletOperationKind = "spend" | "topup" | "void";

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
  sale_transaction_id?: string;
  void_reason?: string;
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
  voided_transaction_id?: string;
};

const prefix = "pinkd.wallet-operation.v1:";

export function readWalletOperation(storage: Storage, operator: string): PendingWalletOperation | null {
  const raw = storage.getItem(prefix + operator);
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingWalletOperation;
  if (value.version !== 1 || value.operator !== operator || !value.id || !value.request?.wallet_id
    || !["spend", "topup", "void"].includes(value.request.kind)) {
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

export type LastPosSale = {
  transactionId: string;
  walletId: string;
  itemName: string;
  coinAmount: number;
  balanceAfter: number;
  refundTransactionId?: string;
};
const salePrefix = "pinkd.last-pos-sale.v1:";

export function readLastPosSale(storage: Storage, operator: string): LastPosSale | null {
  const raw = storage.getItem(salePrefix + operator);
  if (!raw) return null;
  const value = JSON.parse(raw) as LastPosSale;
  if (!value.transactionId || !value.walletId || !Number.isFinite(value.balanceAfter) || !Number.isFinite(value.coinAmount)) {
    throw new Error("Last sale receipt could not be read. Ask an admin to check transactions.");
  }
  return value;
}

export function savePosReceipt(storage: Storage, operation: PendingWalletOperation, result: WalletOperationResult) {
  if (result.status !== "succeeded") return;
  const { request, operator } = operation;
  if (request.kind === "spend") {
    const receipt: LastPosSale = {
      transactionId: result.transaction_id!, walletId: request.wallet_id,
      itemName: request.item_name || "POS item", coinAmount: request.coin_amount!,
      balanceAfter: result.new_coin_balance!,
    };
    storage.setItem(salePrefix + operator, JSON.stringify(receipt));
  } else if (request.kind === "void") {
    const previous = readLastPosSale(storage, operator);
    if (previous?.transactionId === result.voided_transaction_id) {
      storage.setItem(salePrefix + operator, JSON.stringify({ ...previous, refundTransactionId: result.transaction_id }));
    }
  }
}
