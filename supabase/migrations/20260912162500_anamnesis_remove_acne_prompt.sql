-- Remove the standalone acne question from new/current anamnesis forms without touching
-- answers already stored or immutable historical version snapshots.

create or replace function public.anamnesis_form_schema_snapshot_v4()
returns jsonb
language sql
stable
set search_path = public
as $function$
  with base as (
    select public.anamnesis_form_schema_snapshot_v3() as doc
  ), sections as (
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
  )
  select jsonb_set(
    jsonb_set(base.doc, '{version}', to_jsonb(4), false),
    '{sections}',
    coalesce((select jsonb_agg(sections.section order by sections.ordinality) from sections), '[]'::jsonb),
    false
  )
  from base;
$function$;

-- v5 is intentionally left as-is: it composes from v4, so new v5 snapshots also
-- inherit the removal while old anamnesis_versions keep their frozen schema snapshot.
