-- Preserve the original sale; record one compensating coin movement per sale.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reverses_transaction_id uuid REFERENCES public.transactions(id),
  ADD COLUMN IF NOT EXISTS balance_after integer,
  ADD COLUMN IF NOT EXISTS void_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_reversal
  ON public.transactions(reverses_transaction_id) WHERE reverses_transaction_id IS NOT NULL;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_valid_pos_reversal;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_valid_pos_reversal CHECK (
  reverses_transaction_id IS NULL OR (
    type = 'refund' AND coin_amount > 0 AND inr_amount IS NULL
    AND balance_after IS NOT NULL AND balance_after >= 0
    AND void_reason IS NOT NULL AND length(trim(void_reason)) BETWEEN 3 AND 500
  )
);
ALTER TABLE public.wallet_operations DROP CONSTRAINT IF EXISTS wallet_operations_operation_kind_check;
ALTER TABLE public.wallet_operations ADD CONSTRAINT wallet_operations_operation_kind_check
  CHECK (operation_kind IN ('spend', 'topup', 'void'));

CREATE OR REPLACE FUNCTION public.void_pos_sale(p_operation_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_operation public.wallet_operations%ROWTYPE;
  v_sale public.transactions%ROWTYPE;
  v_refund public.transactions%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_reason text := trim(p_request->>'void_reason');
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR coalesce(public.get_current_user_role(), '') <> 'admin' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only admins can void POS sales';
  END IF;
  IF p_operation_id IS NULL OR jsonb_typeof(p_request) IS DISTINCT FROM 'object'
    OR p_request->>'kind' IS DISTINCT FROM 'void' THEN
    RAISE EXCEPTION 'A valid void operation is required';
  END IF;
  INSERT INTO public.wallet_operations(operation_id, operator_id, operation_kind, request)
  VALUES (p_operation_id, v_actor, 'void', p_request) ON CONFLICT DO NOTHING;
  SELECT * INTO v_operation FROM public.wallet_operations WHERE operation_id=p_operation_id FOR UPDATE;
  IF v_operation.operator_id <> v_actor OR v_operation.request IS DISTINCT FROM p_request THEN
    RAISE EXCEPTION USING ERRCODE='P2001', MESSAGE='Operation ID belongs to a different operator or request';
  END IF;
  IF v_operation.result IS NOT NULL THEN RETURN v_operation.result; END IF;
  BEGIN
    IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
      RAISE EXCEPTION 'Enter a void reason between 3 and 500 characters';
    END IF;
    SELECT * INTO v_sale FROM public.transactions
    WHERE id=(p_request->>'sale_transaction_id')::uuid FOR UPDATE;
    IF v_sale.id IS NULL OR v_sale.wallet_id IS DISTINCT FROM (p_request->>'wallet_id')::uuid
      OR v_sale.type NOT IN ('games','drinks','food') OR coalesce(v_sale.coin_amount,0) >= 0 THEN
      RAISE EXCEPTION 'Select an ordinary POS coin sale';
    END IF;
    IF v_sale.reference LIKE 'ROUND\_%' ESCAPE '\'
      OR EXISTS (SELECT 1 FROM public.game_round_players WHERE transaction_id=v_sale.id) THEN
      RAISE EXCEPTION 'Round entries cannot be voided; the no-refund round rule still applies';
    END IF;
    SELECT * INTO v_refund FROM public.transactions WHERE reverses_transaction_id=v_sale.id;
    IF v_refund.id IS NULL THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id=v_sale.wallet_id FOR UPDATE;
      IF v_wallet.id IS NULL OR v_wallet.status <> 'active' THEN
        RAISE EXCEPTION 'The original band is not active. Reconcile reissued or blocked bands with an admin';
      END IF;
      UPDATE public.wallets SET coin_balance=coalesce(coin_balance,0)-v_sale.coin_amount,
        balance=coalesce(coin_balance,0)-v_sale.coin_amount, updated_at=now()
      WHERE id=v_wallet.id RETURNING * INTO v_wallet;
      INSERT INTO public.transactions(wallet_id,type,amount,coin_amount,inr_amount,
        description,reference,game_id,item_name,item_category,staff_user_id,
        reverses_transaction_id,balance_after,void_reason)
      VALUES(v_wallet.id,'refund',-v_sale.coin_amount,-v_sale.coin_amount,NULL,
        'POS sale void: ' || coalesce(v_sale.item_name,'POS item'),'VOID_' || v_sale.id,
        v_sale.game_id,v_sale.item_name,v_sale.item_category,v_actor,
        v_sale.id,v_wallet.coin_balance,v_reason) RETURNING * INTO v_refund;
    END IF;
    v_result := jsonb_build_object('status','succeeded','transaction_id',v_refund.id,
      'voided_transaction_id',v_sale.id,'new_coin_balance',v_refund.balance_after,
      'credited_coin_amount',v_refund.coin_amount);
  EXCEPTION WHEN raise_exception OR check_violation OR foreign_key_violation OR invalid_text_representation THEN
    v_result := jsonb_build_object('status','rejected','message',SQLERRM);
  END;
  UPDATE public.wallet_operations SET result=v_result WHERE operation_id=p_operation_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.void_pos_sale(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_pos_sale(uuid,jsonb) TO authenticated;
