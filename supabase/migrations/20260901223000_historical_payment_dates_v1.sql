-- Hub Giulia — historical payment dates v1
-- Preserves the real calendar day for payments imported as already received.
-- Future receivables remain untouched and continue receiving paid_at only when explicitly confirmed.

create or replace function public.normalize_historical_procedure_payment_paid_at_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  -- The atomic attendance flow marks entries with scheduled_date <= current_date as paid.
  -- When the scheduled date is in the past, this is a historical payment import: keep the
  -- exact day supplied by the professional instead of stamping the day it was entered in Hub.
  if new.scheduled_date is not null
     and new.scheduled_date < current_date
     and new.paid_at is not null then
    new.paid_at := ((new.scheduled_date + time '12:00') at time zone 'America/Sao_Paulo');
  end if;

  return new;
end;
$function$;

drop trigger if exists procedure_payments_historical_paid_at_v1 on public.procedure_payments;
create trigger procedure_payments_historical_paid_at_v1
before insert on public.procedure_payments
for each row execute function public.normalize_historical_procedure_payment_paid_at_v1();

comment on function public.normalize_historical_procedure_payment_paid_at_v1() is
  'On insert, preserves scheduled_date as the calendar day of an already-paid historical payment without affecting future receivables.';
