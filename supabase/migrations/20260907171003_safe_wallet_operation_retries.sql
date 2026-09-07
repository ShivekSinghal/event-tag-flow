-- Durable retry receipts are private. Only the authenticated RPC can read/write them.
CREATE TABLE IF NOT EXISTS public.wallet_operations (
  operation_id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES public.profiles(id),
  operation_kind text NOT NULL CHECK (operation_kind IN ('spend', 'topup')),
  request jsonb NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallet_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_operations FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.manual_topup_receipts (
  canonical_reference text PRIMARY KEY CHECK (canonical_reference <> ''),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_topup_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_topup_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.canonical_manual_receipt(p_reference text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT upper(regexp_replace(
    regexp_replace(coalesce(p_reference, ''), '([[:space:]]+via:phone-lookup)+[[:space:]]*$', '', 'i'),
    '^[[:space:]]+|[[:space:]]+$', '', 'g'));
$$;
REVOKE ALL ON FUNCTION public.canonical_manual_receipt(text) FROM PUBLIC, anon, authenticated;

-- Preserve all historical ledger rows, including old duplicates. Reserve each receipt once.
INSERT INTO public.manual_topup_receipts(canonical_reference, transaction_id, created_at)
SELECT DISTINCT ON (public.canonical_manual_receipt(reference))
  public.canonical_manual_receipt(reference), id, created_at
FROM public.transactions
WHERE type = 'coin_purchase' AND description = 'Pink''D Coin package purchase'
  AND public.canonical_manual_receipt(reference) <> ''
ORDER BY public.canonical_manual_receipt(reference), created_at, id
ON CONFLICT (canonical_reference) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reserve_manual_topup_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reference text := public.canonical_manual_receipt(NEW.reference);
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.get_current_user_role(), '') NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION 'Only admins and studio managers can credit coins';
  END IF;
  IF v_reference = '' THEN RAISE EXCEPTION 'A unique payment receipt reference is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wallets WHERE id = NEW.wallet_id AND status = 'active') THEN
    RAISE EXCEPTION 'Wallet must be active';
  END IF;
  INSERT INTO public.manual_topup_receipts(canonical_reference, transaction_id)
  VALUES (v_reference, NEW.id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P2002', MESSAGE = 'This payment reference has already credited coins. Check the original transaction.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_manual_topup_receipt() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS reserve_manual_topup_receipt ON public.transactions;
CREATE TRIGGER reserve_manual_topup_receipt BEFORE INSERT ON public.transactions
FOR EACH ROW WHEN (NEW.type = 'coin_purchase' AND NEW.description = 'Pink''D Coin package purchase')
EXECUTE FUNCTION public.reserve_manual_topup_receipt();

CREATE OR REPLACE FUNCTION public.execute_wallet_operation(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text := coalesce(public.get_current_user_role(), '');
  v_kind text := p_request->>'kind';
  v_operation public.wallet_operations%ROWTYPE;
  v_result jsonb;
  v_package public.coin_packages%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR v_role NOT IN ('admin', 'staff', 'studio_manager') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sign in with a permitted operator account';
  END IF;
  IF p_operation_id IS NULL OR p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
    OR v_kind IS NULL OR v_kind NOT IN ('spend', 'topup') THEN
    RAISE EXCEPTION 'Valid operation ID and payment request are required';
  END IF;
  -- Recheck privileges even when replaying a completed operation.
  IF v_kind = 'topup' AND v_role NOT IN ('admin', 'studio_manager') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only admins and studio managers can credit coins';
  END IF;
  IF v_kind = 'spend' THEN
    IF coalesce(p_request->>'transaction_type', '') NOT IN ('games', 'drinks', 'food') THEN
      RAISE EXCEPTION 'Invalid transaction type';
    END IF;
    IF v_role <> 'admin' AND NOT coalesce(public.user_has_permission(v_actor,
      CASE WHEN p_request->>'transaction_type' = 'games' THEN 'game' ELSE p_request->>'transaction_type' END,
      CASE WHEN p_request->>'transaction_type' = 'games' THEN (p_request->>'game_id')::uuid ELSE NULL END), false) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This sale is not assigned to your account';
    END IF;
  END IF;

  -- A concurrent insert waits for the first transaction. Wallet movement and receipt
  -- either commit together or both disappear; there is no externally visible pending row.
  INSERT INTO public.wallet_operations(operation_id, operator_id, operation_kind, request)
  VALUES (p_operation_id, v_actor, v_kind, p_request) ON CONFLICT DO NOTHING;
  SELECT * INTO v_operation FROM public.wallet_operations WHERE operation_id = p_operation_id FOR UPDATE;
  IF v_operation.operator_id <> v_actor OR v_operation.request IS DISTINCT FROM p_request THEN
    RAISE EXCEPTION USING ERRCODE = 'P2001', MESSAGE = 'Operation ID belongs to a different operator or payment request';
  END IF;
  IF v_operation.result IS NOT NULL THEN RETURN v_operation.result; END IF;

  BEGIN
    IF v_kind = 'spend' THEN
      SELECT to_jsonb(r) || jsonb_build_object('status', 'succeeded') INTO v_result
      FROM public.spend_wallet_coins(
        (p_request->>'wallet_id')::uuid, (p_request->>'coin_amount')::integer,
        p_request->>'transaction_type', p_request->>'item_name', p_request->>'item_category',
        (p_request->>'game_id')::uuid, p_request->>'reference') r;
    ELSE
      SELECT * INTO v_package FROM public.coin_packages WHERE id = (p_request->>'coin_package_id')::uuid FOR SHARE;
      IF v_package.id IS NULL OR NOT v_package.active
        OR v_package.coin_amount IS DISTINCT FROM (p_request->>'expected_coin_amount')::integer
        OR v_package.inr_amount IS DISTINCT FROM (p_request->>'expected_inr_amount')::numeric THEN
        RAISE EXCEPTION 'The package changed. Confirm the payment amount and select the current package before a new top-up.';
      END IF;
      SELECT to_jsonb(r) || jsonb_build_object('status', 'succeeded') INTO v_result
      FROM public.credit_wallet_coins((p_request->>'wallet_id')::uuid,
        (p_request->>'coin_package_id')::uuid, p_request->>'reference') r;
    END IF;
  EXCEPTION
    -- Expected business rejections roll back all inner wallet/transaction changes and
    -- are recorded as final outcomes. Infrastructure errors escape and roll back everything.
    WHEN raise_exception OR SQLSTATE 'P2002' OR check_violation OR foreign_key_violation OR invalid_text_representation THEN
      v_result := jsonb_build_object('status', 'rejected', 'message', SQLERRM);
  END;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Payment result missing'; END IF;
  UPDATE public.wallet_operations SET result = v_result WHERE operation_id = p_operation_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_wallet_operation(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_wallet_operation(uuid, jsonb) TO authenticated;
