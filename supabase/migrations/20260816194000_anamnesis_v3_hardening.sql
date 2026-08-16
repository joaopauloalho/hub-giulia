-- Hub Giulia 3.9.1 hardening after isolated E2E
-- Keeps v3 draft semantics (missing keys allowed) while making completion validation NULL-safe.

create or replace function public.anamnesis_assert_v3_complete(
  p_conditions jsonb,
  p_medications text,
  p_medications_status text,
  p_surgical_history jsonb,
  p_habits jsonb,
  p_aesthetics jsonb
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_pair text[];
begin
  foreach v_key in array array[
    'hipertensao','hipotensao','diabetes','cancer','problemas_cardiacos','disfuncao_renal',
    'problemas_vasculares','epilepsia','problemas_respiratorios','problemas_tireoide',
    'problemas_coagulacao','marcapasso','fumante','hiv_aids','hepatite'
  ] loop
    if jsonb_typeof(p_conditions -> v_key) is distinct from 'boolean' then
      raise exception 'ANAMNESIS_REQUIRED_BINARY:%', v_key;
    end if;
  end loop;

  if p_medications_status is null or p_medications_status not in ('reported','none') then
    raise exception 'ANAMNESIS_REQUIRED_BINARY:medications';
  end if;
  if p_medications_status = 'reported' and nullif(btrim(coalesce(p_medications,'')), '') is null then
    raise exception 'ANAMNESIS_REQUIRED_DETAIL:medications';
  end if;

  foreach v_key in array array[
    'alergia_medicamento','alergia_frutos_mar','alergia_abelha','outras_alergias',
    'recebeu_anestesia','cirurgias_recentes','protese_metalica','desmaios','herpes','tratamento_medico',
    'acne','ansioso','estressado','enxaqueca','intestino_regular','menstruacao_regular','colica_menstrual'
  ] loop
    if jsonb_typeof(p_surgical_history -> v_key) is distinct from 'boolean' then
      raise exception 'ANAMNESIS_REQUIRED_BINARY:%', v_key;
    end if;
  end loop;

  if coalesce(p_surgical_history ->> 'gestante','') not in ('sim','não','tentando') then
    raise exception 'ANAMNESIS_REQUIRED_CHOICE:gestante';
  end if;

  foreach v_pair slice 1 in array array[
    array['alergia_medicamento','alergia_medicamento_detalhe'],
    array['alergia_frutos_mar','alergia_frutos_mar_detalhe'],
    array['alergia_abelha','alergia_abelha_detalhe'],
    array['outras_alergias','outras_alergias_detalhe'],
    array['recebeu_anestesia','recebeu_anestesia_detalhe'],
    array['cirurgias_recentes','cirurgias_recentes_detalhe'],
    array['protese_metalica','protese_metalica_regiao'],
    array['desmaios','desmaio_porque'],
    array['herpes','herpes_detalhe'],
    array['tratamento_medico','tratamento_medico_detalhe'],
    array['acne','acne_detalhe'],
    array['colica_menstrual','colica_menstrual_detalhe']
  ] loop
    if p_surgical_history ->> v_pair[1] = 'true'
       and nullif(btrim(coalesce(p_surgical_history ->> v_pair[2],'')), '') is null then
      raise exception 'ANAMNESIS_REQUIRED_DETAIL:%', v_pair[1];
    end if;
  end loop;

  foreach v_key in array array[
    'leite_derivados','doces','refrigerante','fast_food','frituras','bebidas_alcoolicas','cigarros',
    'alimentacao_especial','suplemento','atividade_fisica'
  ] loop
    if jsonb_typeof(p_habits -> v_key) is distinct from 'boolean' then
      raise exception 'ANAMNESIS_REQUIRED_BINARY:%', v_key;
    end if;
  end loop;

  foreach v_pair slice 1 in array array[
    array['leite_derivados','leite_derivados_frequencia'],
    array['doces','doces_frequencia'],
    array['refrigerante','refrigerante_frequencia'],
    array['fast_food','fast_food_frequencia'],
    array['frituras','frituras_frequencia'],
    array['bebidas_alcoolicas','bebidas_alcoolicas_frequencia'],
    array['alimentacao_especial','alimentacao_especial_qual'],
    array['suplemento','suplemento_quais'],
    array['atividade_fisica','atividade_fisica_detalhe']
  ] loop
    if p_habits ->> v_pair[1] = 'true'
       and nullif(btrim(coalesce(p_habits ->> v_pair[2],'')), '') is null then
      raise exception 'ANAMNESIS_REQUIRED_DETAIL:%', v_pair[1];
    end if;
  end loop;

  foreach v_key in array array[
    'produto_com_acido','alteracoes_recentes','limpeza_pele','microagulhamento','peeling','laser',
    'toxina_botulinica','fios_sustentacao','preenchimento_hialuronico','bioestimulador',
    'plastica_facial','pmma','outros_tratamentos'
  ] loop
    if jsonb_typeof(p_aesthetics -> v_key) is distinct from 'boolean' then
      raise exception 'ANAMNESIS_REQUIRED_BINARY:%', v_key;
    end if;
  end loop;

  foreach v_pair slice 1 in array array[
    array['produto_com_acido','produto_com_acido_detalhe'],
    array['alteracoes_recentes','alteracoes_recentes_detalhe'],
    array['limpeza_pele','limpeza_pele_data'],
    array['microagulhamento','microagulhamento_data'],
    array['peeling','peeling_detalhe'],
    array['laser','laser_detalhe'],
    array['toxina_botulinica','toxina_botulinica_data'],
    array['fios_sustentacao','fios_sustentacao_data'],
    array['preenchimento_hialuronico','preenchimento_hialuronico_data'],
    array['bioestimulador','bioestimulador_data'],
    array['plastica_facial','plastica_facial_detalhe'],
    array['pmma','pmma_regiao'],
    array['outros_tratamentos','outros_tratamentos_detalhe']
  ] loop
    if p_aesthetics ->> v_pair[1] = 'true'
       and nullif(btrim(coalesce(p_aesthetics ->> v_pair[2],'')), '') is null then
      raise exception 'ANAMNESIS_REQUIRED_DETAIL:%', v_pair[1];
    end if;
  end loop;
end;
$$;

revoke all on function public.anamnesis_assert_v3_complete(jsonb,text,text,jsonb,jsonb,jsonb)
from public, anon, authenticated;
grant execute on function public.anamnesis_assert_v3_complete(jsonb,text,text,jsonb,jsonb,jsonb)
to service_role;

-- RLS remains the tenant boundary for professional reads. No client-side writes are granted.
grant select on table public.anamnesis_signature_links to authenticated;
grant select on table public.anamnesis_signatures to authenticated;

-- The scoped Edge Function uses a service-role client for token validation and finalization.
-- Grant only the table operations it actually performs.
grant select, insert, update on table public.anamnesis_signature_links to service_role;
grant select, insert on table public.anamnesis_signatures to service_role;

revoke all on table public.anamnesis_signature_links from anon;
revoke all on table public.anamnesis_signatures from anon;
