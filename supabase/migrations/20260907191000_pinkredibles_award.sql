-- Direct awards preserve the existing round history, redemption contract and ledger RLS.
-- No game prices, coupon expiry, reissue functions or role policies are replaced here.
ALTER TABLE public.pinkredible_ledger ADD COLUMN entry_transaction_id uuid REFERENCES public.transactions(id), ADD COLUMN game_id uuid REFERENCES public.games(id);
CREATE UNIQUE INDEX pinkredible_one_award_per_entry ON public.pinkredible_ledger(entry_transaction_id) WHERE entry_transaction_id IS NOT NULL;
CREATE INDEX pinkredible_direct_cooldown ON public.pinkredible_ledger(wallet_id,game_id,created_at DESC) WHERE kind='award';
CREATE TABLE public.pinkredible_award_operations(
 operation_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.profiles(id),request jsonb NOT NULL,result jsonb,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.pinkredible_award_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pinkredible_award_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.pinkredible_award_operations TO service_role;

CREATE FUNCTION public.assert_direct_award_permission(p_game_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE role_name text;
BEGIN
 SELECT role::text INTO role_name FROM public.profiles WHERE id=auth.uid() FOR SHARE;
 IF auth.uid() IS NULL OR coalesce(role_name,'') NOT IN ('admin','staff','studio_manager') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Sign in as an assigned game operator'; END IF;
 IF role_name<>'admin' THEN
  PERFORM 1 FROM public.staff_permissions WHERE user_id=auth.uid() AND game_id=p_game_id AND permission_type='game' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='This game is not assigned to you'; END IF;
 END IF;
 PERFORM 1 FROM public.games WHERE id=p_game_id AND available AND awards_pinkredible FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Select an active prize-enabled game'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_direct_award_permission(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.eligible_pinkredible_entries(p_wallet_id uuid,p_game_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.assert_direct_award_permission(p_game_id);
 IF NOT EXISTS(SELECT 1 FROM public.wallets WHERE id=p_wallet_id AND status='active') THEN RAISE EXCEPTION 'Select an active band'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('transaction_id',e.id,'created_at',e.created_at,'coin_amount',-e.coin_amount) ORDER BY e.created_at DESC)
 FROM(SELECT t.id,t.created_at,t.coin_amount FROM public.transactions t WHERE t.wallet_id=p_wallet_id AND t.game_id=p_game_id AND t.type='games' AND t.coin_amount<0
  AND NOT EXISTS(SELECT 1 FROM public.transactions r WHERE r.reverses_transaction_id=t.id)
  AND NOT EXISTS(SELECT 1 FROM public.pinkredible_ledger l WHERE l.entry_transaction_id=t.id)
  AND NOT EXISTS(SELECT 1 FROM public.game_round_players r WHERE r.transaction_id=t.id)
  ORDER BY t.created_at DESC LIMIT 20)e),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.eligible_pinkredible_entries(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.eligible_pinkredible_entries(uuid,uuid) TO authenticated;

CREATE FUNCTION public.award_pinkredible(p_operation_id uuid,p_request jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); operation public.pinkredible_award_operations; sale public.transactions; wallet public.wallets; game public.games;
 v_result jsonb; award_id uuid; gid uuid; wid uuid; tid uuid;
BEGIN
 IF p_operation_id IS NULL OR jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Award operation identity is required'; END IF;
 gid:=(p_request->>'game_id')::uuid; wid:=(p_request->>'wallet_id')::uuid; tid:=(p_request->>'entry_transaction_id')::uuid;
 IF gid IS NULL OR wid IS NULL OR tid IS NULL THEN RAISE EXCEPTION 'Freeze the game, winner and paid entry before awarding'; END IF;
 PERFORM public.assert_direct_award_permission(gid);
 INSERT INTO public.pinkredible_award_operations(operation_id,actor_id,request) VALUES(p_operation_id,actor,p_request) ON CONFLICT DO NOTHING;
 SELECT * INTO operation FROM public.pinkredible_award_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF operation.actor_id<>actor OR operation.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION USING ERRCODE='P2001',MESSAGE='Award identity belongs to a different operator or request'; END IF;
 IF operation.result IS NOT NULL THEN RETURN operation.result; END IF;
 BEGIN
  IF clock_timestamp()>public.pinkredible_expires_at() THEN RAISE EXCEPTION 'Pinkredibles have expired'; END IF;
  -- Use the same lock order as POS void: original sale, then wallet.
  SELECT * INTO sale FROM public.transactions WHERE id=tid FOR UPDATE;
  IF sale.id IS NULL OR sale.wallet_id IS DISTINCT FROM wid OR sale.game_id IS DISTINCT FROM gid OR sale.type<>'games' OR coalesce(sale.coin_amount,0)>=0 THEN RAISE EXCEPTION 'Winner needs a paid entry for this game'; END IF;
  IF EXISTS(SELECT 1 FROM public.transactions WHERE reverses_transaction_id=tid) OR EXISTS(SELECT 1 FROM public.pinkredible_ledger WHERE entry_transaction_id=tid) OR EXISTS(SELECT 1 FROM public.game_round_players WHERE transaction_id=tid) THEN RAISE EXCEPTION 'Entry is voided, already awarded or belongs to a round'; END IF;
  SELECT * INTO wallet FROM public.wallets WHERE id=wid FOR UPDATE;
  IF wallet.id IS NULL OR wallet.status<>'active' THEN RAISE EXCEPTION 'This band is not active'; END IF;
  IF EXISTS(SELECT 1 FROM public.pinkredible_ledger l LEFT JOIN public.game_rounds r ON r.id=l.round_id WHERE l.wallet_id=wid AND coalesce(l.game_id,r.game_id)=gid AND l.kind='award' AND l.created_at>clock_timestamp()-interval '2 minutes') THEN RAISE EXCEPTION 'This band already won this game within two minutes'; END IF;
  SELECT * INTO game FROM public.games WHERE id=gid;
  UPDATE public.wallets SET pinkredible_balance=pinkredible_balance+1,pinkredible_code=coalesce(pinkredible_code,public.generate_pinkredible_code()),updated_at=now() WHERE id=wid RETURNING * INTO wallet;
  INSERT INTO public.pinkredible_ledger(wallet_id,delta,kind,game_name,game_id,entry_transaction_id,staff_user_id,note)
  VALUES(wid,1,'award',game.name,gid,tid,actor,'Paid entry: '||tid::text) RETURNING id INTO award_id;
  v_result:=jsonb_build_object('status','succeeded','awarded',true,'award_id',award_id,'entry_transaction_id',tid,'game',game.name,'first_name',split_part(trim(wallet.attendee_name),' ',1),'pinkredibles',wallet.pinkredible_balance,'code',wallet.pinkredible_code,'value_each_inr',public.pinkredible_value_inr(),'expires_at',public.pinkredible_expires_at());
 EXCEPTION WHEN raise_exception OR check_violation OR foreign_key_violation THEN v_result:=jsonb_build_object('status','rejected','message',SQLERRM); END;
 UPDATE public.pinkredible_award_operations SET result=v_result WHERE operation_id=p_operation_id;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.award_pinkredible(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.award_pinkredible(uuid,jsonb) TO authenticated;

-- The void RPC catches this exception in its wallet-movement subtransaction, undoing the attempted refund.
CREATE FUNCTION public.guard_awarded_entry_void() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.reverses_transaction_id IS NOT NULL THEN
  PERFORM 1 FROM public.transactions WHERE id=NEW.reverses_transaction_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.pinkredible_ledger WHERE entry_transaction_id=NEW.reverses_transaction_id) THEN RAISE EXCEPTION 'An entry that earned a Pinkredible cannot be voided'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_awarded_entry_void() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_awarded_entry_void BEFORE INSERT ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_awarded_entry_void();

CREATE FUNCTION public.direct_award_backend_version() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.direct_award_backend_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.direct_award_backend_version() TO anon,authenticated,service_role;
