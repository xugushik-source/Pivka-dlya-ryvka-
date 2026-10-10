-- Owner, 2026-10-10: Ниноцминда is not open yet (no suppliers there). It stays in the city list, greyed out, with a note.
-- service_cities.soon_note: text after the city name («скоро»); a city with active = false and a note is shown, not selectable.
alter table public.service_cities add column if not exists soon_note text;
update public.service_cities set active = false, soon_note = 'скоро' where name ilike 'Ниноцминд%';

create or replace function public.soon_cities()
returns table (name text, note text) language sql stable security definer set search_path to ''
as $$ select c.name::text, c.soon_note from public.service_cities c where not c.active and c.soon_note is not null order by c.sort_order $$;
grant execute on function public.soon_cities() to anon, authenticated;
