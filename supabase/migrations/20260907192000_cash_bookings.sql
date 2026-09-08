-- Counter cash uses the existing checkout lock and capacity rules.
ALTER TABLE public.event_orders DROP CONSTRAINT IF EXISTS event_orders_payment_provider_check;
ALTER TABLE public.event_orders ADD CONSTRAINT event_orders_payment_provider_check CHECK(payment_provider IN ('manual','cashfree','razorpay','cash'));
CREATE TABLE public.cash_studios(name text PRIMARY KEY);
INSERT INTO public.cash_studios VALUES ('Noida Sector 43 (NDA)'),('Noida Sector 50 (RMG)'),('Pitampura (PP)'),('Rajouri Garden (RG)'),('Preet Vihar (ED)'),('Anand Vihar (AV)'),('Gurgaon (GGN)'),('Indirapuram (IPM)'),('South Delhi (SD)'),('Dwarka (DWK)');
ALTER TABLE public.cash_studios ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.cash_studios TO anon,authenticated;
CREATE POLICY cash_studios_read ON public.cash_studios FOR SELECT TO anon,authenticated USING(true);
CREATE TABLE public.cash_manager_studios(user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,studio text REFERENCES public.cash_studios(name),PRIMARY KEY(user_id,studio));
ALTER TABLE public.cash_manager_studios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_manager_studios FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.cash_manager_studios TO authenticated;
CREATE POLICY cash_assignment_read ON public.cash_manager_studios FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.get_current_user_role()='admin');
CREATE POLICY cash_assignment_add ON public.cash_manager_studios FOR INSERT TO authenticated WITH CHECK(public.get_current_user_role()='admin');
CREATE POLICY cash_assignment_remove ON public.cash_manager_studios FOR DELETE TO authenticated USING(public.get_current_user_role()='admin');
CREATE TABLE public.cash_booking_confirmations(
 order_id uuid PRIMARY KEY REFERENCES public.event_orders(id),studio text NOT NULL REFERENCES public.cash_studios(name),
 code_hash text,code_operation_id uuid,code_expires_at timestamptz,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 sends integer NOT NULL DEFAULT 0 CHECK(sends BETWEEN 0 AND 4),extension_used boolean NOT NULL DEFAULT false,
 requested_by uuid REFERENCES public.profiles(id),confirmed_by uuid REFERENCES public.profiles(id),confirmed_at timestamptz,
 cancelled_by uuid REFERENCES public.profiles(id),cancelled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cash_checkout_requests(operation_id uuid PRIMARY KEY,token_hash text NOT NULL,request jsonb NOT NULL,order_id uuid UNIQUE REFERENCES public.event_orders(id),result jsonb NOT NULL);
CREATE TABLE public.cash_desk_operations(operation_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.profiles(id),request jsonb NOT NULL,result jsonb NOT NULL);
CREATE TABLE public.cash_notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES public.event_orders(id),
 kind text NOT NULL CHECK(kind IN ('code','confirmation','alert')),generation_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','error','obsolete')),
 claim_id uuid,claimed_at timestamptz,first_attempt_at timestamptz,sent_at timestamptz,error text,payload jsonb,provider_id text,UNIQUE(order_id,kind,generation_id));
ALTER TABLE public.cash_booking_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_checkout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_desk_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_booking_confirmations,public.cash_checkout_requests,public.cash_desk_operations,public.cash_notifications FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.cash_booking_confirmations,public.cash_checkout_requests,public.cash_desk_operations,public.cash_notifications,public.cash_manager_studios,public.cash_studios TO service_role;
CREATE FUNCTION public.cash_actor_allowed(p_actor uuid,p_studio text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor AND(p.role='admin' OR(p.role='studio_manager' AND EXISTS(SELECT 1 FROM public.cash_manager_studios s WHERE s.user_id=p.id AND s.studio=p_studio))))
$$;
REVOKE ALL ON FUNCTION public.cash_actor_allowed(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cash_actor_allowed(uuid,text) TO service_role;
CREATE FUNCTION public.create_cash_event_order_checkout(p_operation_id uuid,p_checkout_token_hash text,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.cash_checkout_requests; oid uuid; total numeric; result jsonb; deadline timestamptz;
BEGIN
 IF p_operation_id IS NULL OR p_checkout_token_hash IS NULL OR p_checkout_token_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid cash checkout'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('pinkd_event_checkout'));
 SELECT * INTO saved FROM public.cash_checkout_requests WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF saved.token_hash<>p_checkout_token_hash OR saved.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Checkout identity belongs to another request'; END IF;
  RETURN saved.result;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cash_studios WHERE name=p_request->>'cash_studio') THEN RAISE EXCEPTION 'Select the collecting studio'; END IF;
 IF jsonb_typeof(p_request->'cart_items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'cart_items')=0 THEN RAISE EXCEPTION 'Select tickets'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_request->'cart_items') i WHERE coalesce(i->>'item_type','event_package')<>'event_package' OR i->>'package_key' LIKE 'coin-package:%') THEN RAISE EXCEPTION 'Cash checkout accepts tickets and intensives only'; END IF;
 SELECT order_id,total_amount_inr INTO oid,total FROM public.create_event_order_checkout(p_request->>'customer_name',p_request->>'customer_phone',p_request->>'customer_email',p_request->'cart_items',p_checkout_token_hash,p_request->>'customer_studio',coalesce(p_request->'attribution','{}'::jsonb));
 deadline:=clock_timestamp()+interval '5 minutes';
 UPDATE public.event_orders SET payment_provider='cash',payment_status='manual_payment',checkout_token_expires_at=deadline,payment_reference='CASH pending' WHERE id=oid;
 INSERT INTO public.cash_booking_confirmations(order_id,studio) VALUES(oid,p_request->>'cash_studio');
 result:=jsonb_build_object('order_id',oid,'total_amount_inr',total,'hold_expires_at',deadline);
 INSERT INTO public.cash_checkout_requests VALUES(p_operation_id,p_checkout_token_hash,p_request,oid,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_cash_event_order_checkout(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_cash_event_order_checkout(uuid,text,jsonb) TO anon,authenticated;

-- Service-only: the edge verifies the JWT and supplies the actual actor, never a browser actor ID.
CREATE FUNCTION public.cash_desk_action(p_actor uuid,p_operation_id uuid,p_order_id uuid,p_action text,p_code_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.event_orders;c public.cash_booking_confirmations;saved public.cash_desk_operations;
 req jsonb:=jsonb_build_object('order_id',p_order_id,'action',p_action,'code_hash',p_code_hash); result jsonb;deadline timestamptz;phase public.event_pricing_phases;s record;
BEGIN
 IF p_actor IS NULL OR p_operation_id IS NULL THEN RAISE EXCEPTION 'Identity is required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('pinkd_event_checkout'));
 SELECT * INTO o FROM public.event_orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO c FROM public.cash_booking_confirmations WHERE order_id=p_order_id FOR UPDATE;
 IF c.order_id IS NULL OR NOT public.cash_actor_allowed(p_actor,c.studio) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Cash desk access denied for this studio'; END IF;
 SELECT * INTO saved FROM public.cash_desk_operations WHERE operation_id=p_operation_id;
 IF FOUND THEN
  IF saved.actor_id<>p_actor OR saved.request IS DISTINCT FROM req THEN RAISE EXCEPTION 'Operation identity mismatch'; END IF;
  RETURN saved.result;
 END IF;
 IF o.payment_provider<>'cash' THEN RAISE EXCEPTION 'Not a cash booking'; END IF;
 PERFORM set_config('pinkd.cash_action',o.id::text,true);
 IF public.event_order_is_paid(o.payment_status) THEN result:=jsonb_build_object('status','succeeded','confirmed',true,'order_ref',upper(left(o.id::text,8)));
 ELSIF c.cancelled_at IS NOT NULL THEN result:=jsonb_build_object('status','rejected','error','This cash booking was cancelled');
 ELSIF p_action='cancel' THEN
  UPDATE public.cash_booking_confirmations SET cancelled_at=clock_timestamp(),cancelled_by=p_actor,code_hash=NULL WHERE order_id=o.id;
  UPDATE public.event_orders SET payment_status='cancelled',checkout_token_expires_at=clock_timestamp() WHERE id=o.id;
  UPDATE public.cash_notifications SET status='obsolete' WHERE order_id=o.id AND kind='code' AND status<>'sent';
  result:=jsonb_build_object('status','succeeded','cancelled',true);
 ELSIF p_action='revive' THEN
  IF public.event_order_hold_is_live(o.payment_status,o.checkout_token_expires_at,o.created_at) THEN result:=jsonb_build_object('status','succeeded','revived',false,'hold_expires_at',o.checkout_token_expires_at);
  ELSIF o.created_at<clock_timestamp()-interval '45 minutes' THEN result:=jsonb_build_object('status','rejected','error','Too old to revive; book again');
  ELSE
   phase:=public.resolve_party_phase(true);
   IF EXISTS(SELECT 1 FROM public.event_order_items i LEFT JOIN public.event_packages p ON p.id=i.package_key WHERE i.order_id=o.id AND(p.id IS NULL OR NOT p.active OR p.available_from>clock_timestamp() OR(i.package_category='party' AND i.unit_price_inr IS DISTINCT FROM phase.party_price_inr))) THEN RAISE EXCEPTION 'Package availability or party price changed; book again'; END IF;
   FOR s IN SELECT slot,sum(i.quantity*coalesce(i.pax,1)) needed FROM public.event_order_items i,LATERAL jsonb_array_elements_text(i.selected_time_slots) slot WHERE i.order_id=o.id GROUP BY slot LOOP
    IF NOT EXISTS(SELECT 1 FROM public.get_session_seat_counts() counts WHERE counts.slot_label=s.slot AND counts.booked+counts.held+s.needed<=counts.seat_cap) THEN RAISE EXCEPTION 'Session unavailable; book again'; END IF;
   END LOOP;
   deadline:=clock_timestamp()+interval '5 minutes';
   UPDATE public.event_orders SET payment_status='manual_payment',checkout_token_expires_at=deadline WHERE id=o.id;
   UPDATE public.cash_booking_confirmations SET code_hash=NULL,code_expires_at=NULL WHERE order_id=o.id;
   UPDATE public.cash_notifications SET status='obsolete' WHERE order_id=o.id AND kind='code' AND status<>'sent';
   result:=jsonb_build_object('status','succeeded','revived',true,'hold_expires_at',deadline);
  END IF;
 ELSIF p_action IN ('request_code','confirm') THEN
  IF o.payment_status NOT IN ('pending','manual_payment') OR o.checkout_token_expires_at<=clock_timestamp() OR o.checkout_token_expires_at IS NULL THEN result:=jsonb_build_object('status','rejected','error','Hold expired; revive before taking cash');
  ELSIF p_code_hash IS NULL OR p_code_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid code hash';
  ELSIF p_action='request_code' THEN
   IF c.sends>=4 THEN result:=jsonb_build_object('status','rejected','error','Code send limit reached; cancel and book again');
   ELSE
    deadline:=CASE WHEN c.extension_used THEN o.checkout_token_expires_at ELSE clock_timestamp()+interval '10 minutes' END;
    UPDATE public.cash_booking_confirmations SET code_hash=p_code_hash,code_operation_id=p_operation_id,code_expires_at=deadline,attempts=0,sends=sends+1,extension_used=true,requested_by=p_actor WHERE order_id=o.id;
    UPDATE public.event_orders SET checkout_token_expires_at=deadline WHERE id=o.id;
    UPDATE public.cash_notifications SET status='obsolete' WHERE order_id=o.id AND kind='code' AND status<>'sent';
    INSERT INTO public.cash_notifications(order_id,kind,generation_id) VALUES(o.id,'code',p_operation_id);
    result:=jsonb_build_object('status','succeeded','sent_to',o.customer_email,'hold_expires_at',deadline,'resends_left',3-c.sends);
   END IF;
  ELSIF c.code_hash IS NULL OR c.code_expires_at<=clock_timestamp() THEN result:=jsonb_build_object('status','rejected','error','Code unavailable or expired');
  ELSIF c.attempts>=3 THEN result:=jsonb_build_object('status','rejected','error','Too many wrong codes; send a new code');
  ELSIF c.code_hash<>p_code_hash THEN
   UPDATE public.cash_booking_confirmations SET attempts=attempts+1 WHERE order_id=o.id;
   result:=jsonb_build_object('status','rejected','error','Wrong code','attempts_left',2-c.attempts);
  ELSE
   UPDATE public.cash_booking_confirmations SET confirmed_at=clock_timestamp(),confirmed_by=p_actor,code_hash=NULL WHERE order_id=o.id;
   UPDATE public.event_orders SET payment_status='paid',paid_at=clock_timestamp(),last_payment_verified_at=clock_timestamp(),payment_reference='CASH:'||o.id::text WHERE id=o.id;
   INSERT INTO public.cash_notifications(order_id,kind,generation_id) VALUES(o.id,'confirmation',o.id),(o.id,'alert',o.id) ON CONFLICT DO NOTHING;
   result:=jsonb_build_object('status','succeeded','confirmed',true,'order_ref',upper(left(o.id::text,8)));
  END IF;
 ELSE RAISE EXCEPTION 'Unknown cash action'; END IF;
 INSERT INTO public.cash_desk_operations VALUES(p_operation_id,p_actor,req,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cash_desk_action(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cash_desk_action(uuid,uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.list_cash_desk_orders(p_studio text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(row_data ORDER BY created_at DESC),'[]'::jsonb) FROM(
 SELECT o.created_at,jsonb_build_object('order_id',o.id,'order_ref',upper(left(o.id::text,8)),'customer_name',o.customer_name,'customer_phone_hint','***'||right(o.customer_phone,4),
  'customer_email',o.customer_email,'customer_studio',o.customer_studio,'cash_studio',c.studio,'total_amount_inr',o.total_amount_inr,'payment_status',o.payment_status,'created_at',o.created_at,
  'hold_expires_at',o.checkout_token_expires_at,'hold_live',public.event_order_hold_is_live(o.payment_status,o.checkout_token_expires_at,o.created_at),'code_sent',c.sends>0,'confirmed_at',c.confirmed_at,'cancelled_at',c.cancelled_at,'requested_by',p.full_name,
  'items',(SELECT string_agg(i.package_name||' x'||i.quantity,', ') FROM public.event_order_items i WHERE i.order_id=o.id),
  'notifications',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',n.kind,'status',n.status,'error',n.error)),'[]'::jsonb) FROM public.cash_notifications n WHERE n.order_id=o.id AND n.status<>'obsolete')) row_data
 FROM public.event_orders o JOIN public.cash_booking_confirmations c ON c.order_id=o.id LEFT JOIN public.profiles p ON p.id=coalesce(c.confirmed_by,c.requested_by)
 WHERE public.cash_actor_allowed(auth.uid(),c.studio) AND(p_studio IS NULL OR p_studio='' OR c.studio=p_studio) AND(public.event_order_is_paid(o.payment_status) OR o.created_at>now()-interval '45 minutes')
 ORDER BY o.created_at DESC LIMIT 500) rows
$$;
REVOKE ALL ON FUNCTION public.list_cash_desk_orders(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_cash_desk_orders(text) TO authenticated;
CREATE FUNCTION public.guard_cash_order() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.payment_provider='cash' THEN
  IF (NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.checkout_token_expires_at IS DISTINCT FROM OLD.checkout_token_expires_at) AND current_setting('pinkd.cash_action',true) IS DISTINCT FROM OLD.id::text THEN
   IF NOT(auth.uid() IS NULL AND NEW.payment_status='cancelled' AND OLD.checkout_token_expires_at<clock_timestamp() AND NEW.checkout_token_expires_at IS NOT DISTINCT FROM OLD.checkout_token_expires_at) THEN RAISE EXCEPTION 'Use Cash Desk to change cash reservations'; END IF;
  END IF;
  IF NEW.payment_provider IS DISTINCT FROM 'cash' OR NEW.cashfree_order_id IS DISTINCT FROM OLD.cashfree_order_id OR NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id THEN RAISE EXCEPTION 'Cash orders cannot switch gateways'; END IF;
  IF public.event_order_is_paid(NEW.payment_status) AND NOT EXISTS(SELECT 1 FROM public.cash_booking_confirmations c WHERE c.order_id=OLD.id AND c.confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Confirm cash through Cash Desk'; END IF;
  IF public.event_order_is_paid(OLD.payment_status) AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN RAISE EXCEPTION 'A paid cash order cannot be downgraded'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_cash_order BEFORE UPDATE ON public.event_orders FOR EACH ROW EXECUTE FUNCTION public.guard_cash_order();
REVOKE ALL ON FUNCTION public.guard_cash_order() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.cash_backend_version() RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.cash_backend_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_backend_version() TO anon,authenticated,service_role;

CREATE FUNCTION public.cash_checkout_status(p_order_id uuid,p_checkout_token_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('order_id',o.id,'total_amount_inr',o.total_amount_inr,'payment_status',o.payment_status,'hold_expires_at',o.checkout_token_expires_at,'cash_studio',c.studio,'email_sent',o.confirmation_email_sent_at IS NOT NULL)
 FROM public.event_orders o JOIN public.cash_booking_confirmations c ON c.order_id=o.id JOIN public.cash_checkout_requests r ON r.order_id=o.id
 WHERE o.id=p_order_id AND r.token_hash=p_checkout_token_hash
$$;
REVOKE ALL ON FUNCTION public.cash_checkout_status(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_checkout_status(uuid,text) TO anon,authenticated;

CREATE FUNCTION public.claim_cash_notification(p_id uuid,p_claim uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 WITH claimed AS (
  UPDATE public.cash_notifications SET status='sending',claim_id=p_claim,claimed_at=clock_timestamp(),first_attempt_at=coalesce(first_attempt_at,clock_timestamp())
  WHERE id=p_id AND(status IN ('pending','error') OR(status='sending' AND claimed_at<clock_timestamp()-interval '2 minutes'))
  RETURNING *
 ) SELECT to_jsonb(claimed) FROM claimed
$$;
REVOKE ALL ON FUNCTION public.claim_cash_notification(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_cash_notification(uuid,uuid) TO service_role;
