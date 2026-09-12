-- Allow compact observations to be attached to both Sim and Não answers.
-- Existing answer JSON stays backward-compatible; this only enriches future frozen
-- schema snapshots so summaries/signature screens render the observation on either answer.

create or replace function public.anamnesis_form_schema_snapshot_v4()
returns jsonb
language sql
stable
set search_path = public
as $function$
  with base as (
    select public.anamnesis_form_schema_snapshot_v3() as doc
  ), normalized_sections as (
    select
      s.ordinality,
      case
        when s.section ->> 'key' = 'skin_review' then
          jsonb_set(
            s.section,
            '{fields}',
            coalesce((
              select jsonb_agg(f.item order by f.ordinality)
              from jsonb_array_elements(s.section -> 'fields') with ordinality as f(item, ordinality)
              where f.item ->> 'key' <> 'ultima_limpeza_pele'
            ), '[]'::jsonb),
            false
          )
        when s.section ->> 'key' = 'medical_history' then
          jsonb_set(
            s.section,
            '{fields}',
            coalesce((
              select jsonb_agg(f.item order by f.ordinality)
              from jsonb_array_elements(s.section -> 'fields') with ordinality as f(item, ordinality)
              where f.item ->> 'key' <> 'acne'
            ), '[]'::jsonb),
            false
          )
        else s.section
      end as section
    from base
    cross join lateral jsonb_array_elements(base.doc -> 'sections') with ordinality as s(section, ordinality)
  ), decorated_sections as (
    select
      ns.ordinality,
      jsonb_set(
        ns.section,
        '{fields}',
        coalesce((
          select jsonb_agg(
            case
              when f.item ->> 'type' in ('boolean', 'boolean_detail', 'boolean_frequency') then
                jsonb_set(
                  jsonb_set(f.item, '{type}', to_jsonb('procedure_note'::text), false),
                  '{detail_key}',
                  to_jsonb(
                    case
                      when f.item ->> 'key' = 'menstruacao_regular' then 'menstruacao_regular_detalhe'
                      else coalesce(f.item ->> 'detail_key', (f.item ->> 'key') || '_observacao')
                    end
                  ),
                  true
                )
              else f.item
            end
            order by f.ordinality
          )
          from jsonb_array_elements(ns.section -> 'fields') with ordinality as f(item, ordinality)
        ), '[]'::jsonb),
        false
      ) as section
    from normalized_sections ns
  )
  select jsonb_set(
    jsonb_set(base.doc, '{version}', to_jsonb(4), false),
    '{sections}',
    coalesce((select jsonb_agg(ds.section order by ds.ordinality) from decorated_sections ds), '[]'::jsonb),
    false
  )
  from base;
$function$;

revoke all on function public.anamnesis_form_schema_snapshot_v4() from public;
grant execute on function public.anamnesis_form_schema_snapshot_v4() to authenticated, service_role;
