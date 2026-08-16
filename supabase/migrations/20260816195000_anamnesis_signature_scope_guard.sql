-- Hub Giulia 3.9.1: bind every signature link/signature to the exact patient + owner + immutable version.

create or replace function public.anamnesis_signature_scope_guard_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
begin
  if not exists (
    select 1
    from public.anamnesis_versions v
    where v.id = new.anamnesis_version_id
      and v.user_id = new.user_id
      and v.patient_id = new.patient_id
  ) then
    raise exception 'ANAMNESIS_SIGNATURE_SCOPE_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.patients p
    where p.id = new.patient_id
      and p.user_id = new.user_id
  ) then
    raise exception 'ANAMNESIS_SIGNATURE_PATIENT_SCOPE_MISMATCH';
  end if;

  select public.anamnesis_version_content_sha256_v1(new.anamnesis_version_id)
    into v_hash;

  if v_hash is null or new.content_sha256 is distinct from v_hash then
    raise exception 'ANAMNESIS_SIGNATURE_CONTENT_HASH_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function public.anamnesis_signature_scope_guard_v1()
from public, anon, authenticated;
grant execute on function public.anamnesis_signature_scope_guard_v1()
to service_role;

drop trigger if exists anamnesis_signature_link_scope_guard_v1 on public.anamnesis_signature_links;
create trigger anamnesis_signature_link_scope_guard_v1
before insert or update of user_id, patient_id, anamnesis_version_id, content_sha256
on public.anamnesis_signature_links
for each row execute function public.anamnesis_signature_scope_guard_v1();

drop trigger if exists anamnesis_signature_scope_guard_v1 on public.anamnesis_signatures;
create trigger anamnesis_signature_scope_guard_v1
before insert
on public.anamnesis_signatures
for each row execute function public.anamnesis_signature_scope_guard_v1();
