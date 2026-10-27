-- Contrato de segurança da busca de pacientes (somente leitura).
do $$
begin
  if to_regprocedure('public.search_patients_v1(text,text)') is null then
    raise exception 'search_patients_v1 missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.patients'::regclass) then
    raise exception 'patients RLS disabled';
  end if;
  if has_function_privilege('anon','public.search_patients_v1(text,text)','execute') then
    raise exception 'anon can execute search_patients_v1';
  end if;
  if not has_function_privilege('authenticated','public.search_patients_v1(text,text)','execute') then
    raise exception 'authenticated cannot execute search_patients_v1';
  end if;
end $$;
