create or replace function public.touch_procedure_return_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_procedure_returns_touch_updated_at on public.procedure_returns;
create trigger trg_procedure_returns_touch_updated_at
before update on public.procedure_returns
for each row execute function public.touch_procedure_return_updated_at();
