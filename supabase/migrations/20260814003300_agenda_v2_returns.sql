-- Hub Giulia 1.9 — Retornos 2.0 remains the single return system.
-- The existing schedule_procedure_return_v2 function keeps creating/linking the
-- appointment. Agenda 2.0's appointment trigger snapshots duration automatically.
-- This trigger only stamps the linked appointment origin after the return link is set.

create or replace function public.mark_return_appointment_source_v2()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.appointment_id is not null
     and new.appointment_id is distinct from old.appointment_id then
    update public.appointments
    set source = 'return'
    where id = new.appointment_id
      and user_id = new.user_id;
  end if;
  return new;
end;
$function$;

revoke all on function public.mark_return_appointment_source_v2() from public;
revoke all on function public.mark_return_appointment_source_v2() from anon;

drop trigger if exists trg_mark_return_appointment_source_v2 on public.procedure_returns;
create trigger trg_mark_return_appointment_source_v2
after update of appointment_id on public.procedure_returns
for each row execute function public.mark_return_appointment_source_v2();
