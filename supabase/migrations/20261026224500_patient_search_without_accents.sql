-- Pesquisa de pacientes sem diferenciar acentos, respeitando RLS e o usuário autenticado.
-- SECURITY INVOKER garante que a política patients_own continue sendo aplicada.
create extension if not exists unaccent with schema extensions;

create or replace function public.search_patients_v1(
  p_search text default null,
  p_archive_mode text default 'active'
)
returns setof public.patients
language sql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
  select p.*
  from public.patients p
  where p.user_id = (select auth.uid())
    and (
      (p_archive_mode = 'active' and p.archived_at is null)
      or (p_archive_mode = 'archived' and p.archived_at is not null)
      or (p_archive_mode = 'all')
    )
    and (
      nullif(btrim(p_search), '') is null
      or strpos(
        lower(extensions.unaccent(regexp_replace(btrim(p.name), '\s+', ' ', 'g'))),
        lower(extensions.unaccent(regexp_replace(btrim(p_search), '\s+', ' ', 'g')))
      ) > 0
      or strpos(lower(coalesce(p.phone, '')), lower(btrim(p_search))) > 0
      or strpos(lower(coalesce(p.email, '')), lower(btrim(p_search))) > 0
    );
$$;

revoke all on function public.search_patients_v1(text, text) from public, anon;
grant execute on function public.search_patients_v1(text, text) to authenticated;
