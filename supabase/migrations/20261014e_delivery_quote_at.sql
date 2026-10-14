-- Delivery fee for a pre-order is quoted as of the chosen time (night fee after 23:00).
create or replace function public.delivery_quote_at(p_zone uuid default null, p_phone text default null, p_fulfillment text default 'delivery',
  p_subtotal numeric default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r jsonb;
begin
  if p_at is not null then perform set_config('pivka.at', p_at::text, true); end if;
  r := private.delivery_quote(p_zone, p_phone, p_fulfillment, p_subtotal);
  perform set_config('pivka.at', '', true);
  return r;
end $$;
grant execute on function public.delivery_quote_at(uuid,text,text,numeric,timestamptz) to anon, authenticated;
