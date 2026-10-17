-- Rating after delivery: 5 stars + «Что улучшить» on the order page, one per order (it can be changed),
-- kept next to the order in order_ratings; the owner gets it in the bot.
create or replace function public.order_rating(p_order uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('rating', rating, 'comment', comment) from public.order_ratings where order_id = p_order
$$;

create or replace function public.rate_order(p_order uuid, p_rating int, p_comment text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_status text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Оценка — от 1 до 5'; end if;
  select status into v_status from public.orders where id = p_order;
  if v_status is null then raise exception 'Заказ не найден'; end if;
  if v_status <> 'DELIVERED' then raise exception 'Оценить можно после доставки'; end if;
  insert into public.order_ratings(order_id, rating, comment)
  values (p_order, p_rating, nullif(left(trim(coalesce(p_comment, '')), 1000), ''))
  on conflict (order_id) do update set rating = excluded.rating, comment = excluded.comment, created_at = now();
  perform private.tg_post(jsonb_build_object('action', 'order_rated', 'order_id', p_order));
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.order_rating(uuid) to anon, authenticated;
grant execute on function public.rate_order(uuid, int, text) to anon, authenticated;
