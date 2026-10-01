-- Stage 4: the customer sees the status of the order they just placed.
-- The browser keeps the order id (a random uuid returned at checkout) and asks for its status — no phone, no login.
-- Only the status and step times are returned: no name, phone, address or items.
create or replace function public.order_track(p_order uuid)
returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'order_number', o.order_number, 'status', o.status, 'fulfillment', o.fulfillment_type, 'total', o.total,
    'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'ready_at', o.ready_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at, 'now', now())
  from public.orders o where o.id = p_order
$$;
revoke all on function public.order_track(uuid) from public;
grant execute on function public.order_track(uuid) to anon, authenticated;
