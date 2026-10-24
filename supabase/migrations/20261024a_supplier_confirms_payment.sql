-- Владелец, 24.10.2026: оплату поставщику отмечает сам поставщик — кнопкой «Получил деньги» в своём чате.
-- Владелец может отметить сам, только если поставщик не подключён к боту.
create or replace function public.tg_supplier_day(p_chat bigint, p_settlement uuid, p_action text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare st public.supplier_settlements; v_sum numeric; v_method text;
begin
  if p_action = 'note' then
    select ss.* into st from public.supplier_settlements ss join public.telegram_links l on l.ref_id = ss.supplier_id
     where l.kind = 'SUPPLIER' and l.active and l.chat_id = p_chat and ss.supplier_status = 'DISPUTED' and ss.supplier_note is null
       and ss.replied_at > now() - interval '1 day'
     order by ss.replied_at desc limit 1;
    if st.id is null then return jsonb_build_object('error', 'none'); end if;
    update public.supplier_settlements set supplier_note = left(trim(p_note), 500) where id = st.id;
    return jsonb_build_object('ok', true, 'id', st.id);
  end if;

  select * into st from public.supplier_settlements where id = p_settlement for update;
  if st.id is null then return jsonb_build_object('error', 'not_found'); end if;

  if p_action in ('paid', 'paid_cash', 'paid_transfer') then
    if not exists (select 1 from public.telegram_links where kind = 'OWNER' and active and chat_id = p_chat) then
      return jsonb_build_object('error', 'forbidden');
    end if;
    if exists (select 1 from public.telegram_links where kind = 'SUPPLIER' and active and ref_id = st.supplier_id and chat_id is not null) then
      return jsonb_build_object('error', 'supplier_confirms');
    end if;
    if st.status = 'PAID' then return jsonb_build_object('error', 'already'); end if;
    v_method := case when p_action = 'paid_transfer' then 'TRANSFER' else 'CASH' end;
    v_sum := private.supplier_pay(st.supplier_id, st.settlement_date, v_method);
    return jsonb_build_object('ok', true, 'amount', v_sum, 'method', v_method);
  end if;

  if not exists (select 1 from public.telegram_links where kind = 'SUPPLIER' and active and chat_id = p_chat and ref_id = st.supplier_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if p_action in ('got_cash', 'got_transfer') then
    if st.status = 'PAID' then return jsonb_build_object('error', 'already'); end if;
    v_method := case when p_action = 'got_transfer' then 'TRANSFER' else 'CASH' end;
    update public.supplier_settlements set supplier_status = 'AGREED', replied_at = coalesce(replied_at, now()) where id = st.id;
    v_sum := private.supplier_pay(st.supplier_id, st.settlement_date, v_method);
    return jsonb_build_object('ok', true, 'amount', v_sum, 'method', v_method);
  elsif p_action = 'ok' then
    update public.supplier_settlements set supplier_status = 'AGREED', supplier_note = null, replied_at = now() where id = st.id;
  elsif p_action = 'bad' then
    update public.supplier_settlements set supplier_status = 'DISPUTED', supplier_note = null, replied_at = now() where id = st.id;
  else
    return jsonb_build_object('error', 'action');
  end if;
  return jsonb_build_object('ok', true);
end $function$;
