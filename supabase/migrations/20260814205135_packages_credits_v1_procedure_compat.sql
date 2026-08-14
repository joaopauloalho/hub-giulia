-- Backward compatibility for legacy procedure writers that do not send coverage fields.
create or replace function public.normalize_procedure_coverage_defaults_v1()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.covered_value:=coalesce(new.covered_value,0);
  if new.covered_value=0 and coalesce(new.gross_value,0)=0 and coalesce(new.total_value,0)<>0 then new.gross_value:=new.total_value; else new.gross_value:=coalesce(new.gross_value,0); end if;
  return new;
end; $$;
create trigger procedures_normalize_coverage_biu before insert or update of total_value,gross_value,covered_value on public.procedures for each row execute function public.normalize_procedure_coverage_defaults_v1();

create or replace function public.normalize_procedure_item_coverage_defaults_v1()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.coverage_value_snapshot:=coalesce(new.coverage_value_snapshot,0);
  if new.coverage_value_snapshot=0 and coalesce(new.amount_due_snapshot,0)=0 and coalesce(new.final_price,0)<>0 then new.amount_due_snapshot:=new.final_price; else new.amount_due_snapshot:=coalesce(new.amount_due_snapshot,0); end if;
  return new;
end; $$;
create trigger procedure_items_normalize_coverage_biu before insert or update of final_price,coverage_value_snapshot,amount_due_snapshot on public.procedure_items for each row execute function public.normalize_procedure_item_coverage_defaults_v1();

revoke all on function public.normalize_procedure_coverage_defaults_v1() from public,anon,authenticated;
revoke all on function public.normalize_procedure_item_coverage_defaults_v1() from public,anon,authenticated;
