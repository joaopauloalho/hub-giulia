-- New women's health questions for future finalized anamneses.
-- Keep v5 RPC compatibility. Historical schema/answers snapshots are immutable,
-- and existing tipo_parto values remain in historical records.
-- The draft surgical_history JSON already supports these optional string / boolean keys.

create or replace function public.anamnesis_form_schema_snapshot_v5()
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select public.anamnesis_form_schema_snapshot_v4() as doc
  ), existing as (
    select (s.ordinality * 2)::bigint as sort_key,
      case when s.section ->> 'key' = 'womens_health' then
        jsonb_set(
          s.section, '{fields}',
          coalesce((
            select jsonb_agg(f.item order by f.ordinality)
            from jsonb_array_elements(s.section -> 'fields') with ordinality as f(item, ordinality)
            where f.item ->> 'key' = 'tem_filhos'
          ), '[]'::jsonb)
          || jsonb_build_array(
            jsonb_build_object('key', 'filhos_detalhes', 'label', 'Informações dos filhos', 'type', 'children_list', 'when', 'tem_filhos=true')
          )
          || coalesce((
            select jsonb_agg(
              case when f.item ->> 'key' = 'gestante'
                then jsonb_set(f.item, '{options}', jsonb_build_array('sim', 'não'), false)
                else f.item end order by f.ordinality
            )
            from jsonb_array_elements(s.section -> 'fields') with ordinality as f(item, ordinality)
            where f.item ->> 'key' in ('gestante','quantas_gestacoes')
          ), '[]'::jsonb)
          || jsonb_build_array(
            jsonb_build_object('key', 'amamentando', 'label', 'Está amamentando?', 'type', 'boolean')
          )
          || coalesce((
            select jsonb_agg(f.item order by f.ordinality)
            from jsonb_array_elements(s.section -> 'fields') with ordinality as f(item, ordinality)
            where f.item ->> 'key' not in ('tem_filhos','gestante','quantas_gestacoes','tipo_parto')
          ), '[]'::jsonb),
          false
        )
      else s.section end as section
    from base
    cross join lateral jsonb_array_elements(base.doc -> 'sections') with ordinality as s(section, ordinality)
  ), injected as (
    select
      (existing.sort_key + 1)::bigint as sort_key,
      jsonb_build_object(
        'key','intolerances',
        'title','Intolerâncias e restrições alimentares',
        'fields',jsonb_build_array(
          jsonb_build_object('key','intolerancia_lactose','label','Intolerância à lactose?','type','boolean_detail','detail_key','intolerancia_lactose_detalhe'),
          jsonb_build_object('key','doenca_celiaca_sensibilidade_gluten','label','Doença celíaca ou sensibilidade ao glúten?','type','boolean_detail','detail_key','doenca_celiaca_sensibilidade_gluten_detalhe'),
          jsonb_build_object('key','outras_intolerancias_restricoes','label','Outra intolerância ou restrição alimentar?','type','boolean_detail','detail_key','outras_intolerancias_restricoes_detalhe')
        )
      ) as section
    from existing
    where existing.section ->> 'key' = 'allergies'
  ), combined as (
    select * from existing
    union all
    select * from injected
  )
  select jsonb_set(
    jsonb_set(base.doc, '{version}', to_jsonb(5), false),
    '{sections}',
    coalesce((select jsonb_agg(combined.section order by combined.sort_key) from combined), '[]'::jsonb),
    false
  )
  from base;
$$;

revoke all on function public.anamnesis_form_schema_snapshot_v5() from public;
grant execute on function public.anamnesis_form_schema_snapshot_v5() to authenticated, service_role;

