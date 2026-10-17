-- Server clock for the storefront (opening hours by the server's time, not the phone's).
create or replace function public.server_now() returns timestamptz language sql stable set search_path to '' as $$ select now() $$;
grant execute on function public.server_now() to anon, authenticated;
