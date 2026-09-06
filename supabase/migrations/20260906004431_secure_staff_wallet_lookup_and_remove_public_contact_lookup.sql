-- "Can't scan? Find by phone" — backend for Top Up, POS and Check Coins.
-- Admins and studio managers can call it. Staff need at least one assigned POS
-- permission so a newly authenticated account cannot enumerate wallets.
-- Returns the active bands matching a phone / name / order ref, with just enough to confirm
-- the right person: first name, last 3 of the tag id, balance. No emails, no full phone.
-- Run in Supabase SQL editor (Pink_Wallet). Idempotent.

create or replace function public.staff_find_wallet(p_query text)
returns table (
  wallet_id     uuid,
  attendee_name text,
  band_hint     text,
  coin_balance  integer,
  studio        text,
  match_kind    text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_q     text := lower(trim(coalesce(p_query, '')));
  v_phone text := public.normalize_phone_digits(p_query);
  v_ref   text := upper(regexp_replace(trim(coalesce(p_query, '')), '[^a-zA-Z0-9]', '', 'g'));
  v_role  text := coalesce(public.get_current_user_role(), '');
begin
  if auth.uid() is null or not (
    v_role in ('admin', 'studio_manager')
    or (
      v_role = 'staff'
      and (
        public.user_has_permission(auth.uid(), 'game', null)
        or public.user_has_permission(auth.uid(), 'food', null)
        or public.user_has_permission(auth.uid(), 'drinks', null)
      )
    )
  ) then
    raise exception 'You do not have permission to look up bands';
  end if;
  if length(v_q) < 3 then
    raise exception 'Type at least 3 characters';
  end if;

  return query
  select w.id, split_part(trim(coalesce(w.attendee_name, '')), ' ', 1), right(w.tag_id, 3), coalesce(w.coin_balance, 0), w.studio,
         case
           when length(v_phone) = 10 and public.normalize_phone_digits(w.attendee_phone) = v_phone then 'band_phone'
           when length(v_phone) = 10 and o.id is not null
                and public.normalize_phone_digits(o.customer_phone) = v_phone then 'booking_phone'
           when o.id is not null and length(v_ref) between 6 and 8
                and v_ref = upper(left(replace(o.id::text, '-', ''), length(v_ref))) then 'order_ref'
           else 'name'
         end
  from public.wallets w
  left join public.event_orders o on o.id = w.event_order_id
  where w.status = 'active'
    and (
      (length(v_phone) = 10 and public.normalize_phone_digits(w.attendee_phone) = v_phone)
      or (length(v_phone) = 10 and o.id is not null
          and public.normalize_phone_digits(o.customer_phone) = v_phone)
      or (o.id is not null and length(v_ref) between 6 and 8
          and v_ref = upper(left(replace(o.id::text, '-', ''), length(v_ref)))
      )
      or (length(v_phone) <> 10 and lower(coalesce(w.attendee_name, '')) like '%' || v_q || '%')
    )
  order by
    case when length(v_phone) = 10 then 0 else 1 end,
    w.attendee_name
  limit 12;
end;
$$;

revoke all on function public.staff_find_wallet(text) from public, anon, authenticated;
grant execute on function public.staff_find_wallet(text) to authenticated;

-- This contact-only anonymous lookup was manually created in production but is
-- unused by the application. /coins continues to use lookup_party_order, which
-- requires the existing booking proof flow.
drop function if exists public.lookup_bands_for_contact(text);

-- Test while signed in as any staff user (SQL editor runs as postgres, so test from the app):
-- select * from public.staff_find_wallet('98732 77872');
