-- Hub Giulia 3.6 — consolidated photo reads. SECURITY INVOKER keeps RLS as the authority.

create or replace function public.list_patient_photo_sessions_v1(
  p_patient_id uuid,
  p_limit integer default 20,
  p_offset integer default 0,
  p_service_id uuid default null,
  p_session_type text default null,
  p_from date default null,
  p_to date default null
)
returns table(
  session_id uuid,
  patient_id uuid,
  appointment_id uuid,
  procedure_id uuid,
  service_id uuid,
  service_name text,
  session_type text,
  capture_set text,
  title text,
  captured_at timestamptz,
  notes text,
  photo_count bigint,
  photos jsonb
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    s.id,
    s.patient_id,
    s.appointment_id,
    s.procedure_id,
    s.service_id,
    s.service_name_snapshot,
    s.session_type,
    s.capture_set,
    s.title,
    s.captured_at,
    s.notes,
    count(p.id)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id',p.id,
          'photo_session_id',p.photo_session_id,
          'patient_id',p.patient_id,
          'procedure_id',p.procedure_id,
          'appointment_id',p.appointment_id,
          'service_id',p.service_id,
          'photo_type',p.photo_type,
          'label',p.label,
          'caption',p.caption,
          'angle',p.angle,
          'region',p.region,
          'pose',p.pose,
          'taken_at',p.taken_at,
          'photo_url',p.photo_url,
          'original_path',coalesce(p.original_path,p.photo_url),
          'preview_path',p.preview_path,
          'thumbnail_path',p.thumbnail_path,
          'mime_type',p.mime_type,
          'width',p.width,
          'height',p.height,
          'size_bytes',p.size_bytes,
          'sha256',p.sha256,
          'source_type',p.source_type
        ) order by p.taken_at,p.id
      ) filter (where p.id is not null),
      '[]'::jsonb
    ) as photos
  from public.patient_photo_sessions s
  left join public.patient_photos p
    on p.photo_session_id=s.id
   and p.user_id=s.user_id
   and p.voided_at is null
  where s.user_id=(select auth.uid())
    and s.patient_id=p_patient_id
    and s.voided_at is null
    and (p_service_id is null or s.service_id=p_service_id)
    and (p_session_type is null or s.session_type=p_session_type)
    and (p_from is null or s.captured_at>=p_from::timestamptz)
    and (p_to is null or s.captured_at<(p_to+1)::timestamptz)
  group by s.id
  order by s.captured_at desc,s.id desc
  limit greatest(1,least(coalesce(p_limit,20),50))
  offset greatest(coalesce(p_offset,0),0);
$$;

revoke all on function public.list_patient_photo_sessions_v1(uuid,integer,integer,uuid,text,date,date) from public,anon;
grant execute on function public.list_patient_photo_sessions_v1(uuid,integer,integer,uuid,text,date,date) to authenticated;

create or replace function public.list_photo_session_counts_by_procedure_v1(p_patient_id uuid)
returns table(procedure_id uuid,photo_session_count bigint,photo_count bigint)
language sql
stable
security invoker
set search_path=public
as $$
  select
    pr.id,
    count(distinct s.id) filter (where s.id is not null)::bigint,
    count(distinct ph.id) filter (where ph.id is not null)::bigint
  from public.procedures pr
  left join public.patient_photo_sessions s
    on s.user_id=pr.user_id
   and s.patient_id=pr.patient_id
   and s.voided_at is null
   and (s.procedure_id=pr.id or (s.procedure_id is null and pr.appointment_id is not null and s.appointment_id=pr.appointment_id))
  left join public.patient_photos ph
    on ph.user_id=pr.user_id
   and ph.patient_id=pr.patient_id
   and ph.voided_at is null
   and (ph.procedure_id=pr.id or ph.photo_session_id=s.id)
  where pr.user_id=(select auth.uid())
    and pr.patient_id=p_patient_id
  group by pr.id;
$$;

revoke all on function public.list_photo_session_counts_by_procedure_v1(uuid) from public,anon;
grant execute on function public.list_photo_session_counts_by_procedure_v1(uuid) to authenticated;

-- Attendance keeps the 3.5 contract, but voided photos no longer inflate the factual count.
create or replace function public.get_attendance_context_v1(p_appointment_id uuid)
returns table(
  appointment_id uuid,
  patient_id uuid,
  patient_name text,
  patient_phone text,
  service_id uuid,
  service_name text,
  service_is_injectable boolean,
  scheduled_at timestamptz,
  duration_minutes integer,
  appointment_status text,
  anamnesis_status text,
  anamnesis_last_saved_at timestamptz,
  photo_count bigint,
  procedure_id uuid,
  procedure_performed_at timestamptz,
  procedure_total_value numeric,
  procedure_gross_value numeric,
  procedure_covered_value numeric,
  procedure_pending_amount numeric,
  contract_count bigint,
  payment_count bigint,
  injectable_map_count bigint
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    a.id,
    a.patient_id,
    p.name,
    p.phone,
    a.service_id,
    s.name,
    coalesce(s.is_injectable,false),
    a.scheduled_at,
    coalesce(a.duration_minutes,s.duration_minutes,60)::integer,
    a.status,
    an.status,
    an.last_saved_at,
    (select count(*) from public.patient_photos ph where ph.user_id=auth.uid() and ph.patient_id=a.patient_id and ph.voided_at is null),
    pr.id,
    pr.performed_at,
    pr.total_value,
    pr.gross_value,
    pr.covered_value,
    pr.pending_amount,
    (select count(*) from public.contracts c where c.user_id=auth.uid() and c.patient_id=a.patient_id and (c.appointment_id=a.id or (pr.id is not null and c.procedure_id=pr.id))),
    (select count(*) from public.procedure_payments pp where pp.user_id=auth.uid() and pr.id is not null and pp.procedure_id=pr.id),
    (select count(*) from public.injectable_maps im where im.user_id=auth.uid() and im.patient_id=a.patient_id and (pr.id is null or im.procedure_id=pr.id))
  from public.appointments a
  join public.patients p on p.id=a.patient_id and p.user_id=auth.uid()
  left join public.services s on s.id=a.service_id and s.user_id=auth.uid()
  left join lateral (
    select current_anamnesis.status,current_anamnesis.last_saved_at
    from public.anamnesis current_anamnesis
    where current_anamnesis.user_id=auth.uid() and current_anamnesis.patient_id=a.patient_id
    order by current_anamnesis.updated_at desc nulls last,current_anamnesis.created_at desc
    limit 1
  ) an on true
  left join lateral (
    select proc.id,proc.performed_at,proc.total_value,proc.gross_value,proc.covered_value,proc.pending_amount
    from public.procedures proc
    where proc.user_id=auth.uid() and proc.appointment_id=a.id
    order by proc.performed_at desc,proc.created_at desc
    limit 1
  ) pr on true
  where auth.uid() is not null and a.user_id=auth.uid() and a.id=p_appointment_id;
$$;

revoke all on function public.get_attendance_context_v1(uuid) from public,anon;
grant execute on function public.get_attendance_context_v1(uuid) to authenticated;

-- Patient 360 timeline: one event per photo session; legacy photos remain one event each.
create or replace function public.list_patient_timeline_v1(
  p_patient_id uuid,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null
)
returns table(
  event_key text,
  event_type text,
  occurred_at timestamptz,
  title text,
  subtitle text,
  source_id uuid,
  metadata jsonb
)
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_uid uuid:=auth.uid();
  v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  if v_uid is null then raise exception 'PATIENT_360_SESSION_REQUIRED'; end if;
  if not exists(select 1 from public.patients p where p.id=p_patient_id and p.user_id=v_uid) then raise exception 'PATIENT_360_NOT_FOUND'; end if;

  return query
  with return_rows as materialized(
    select pr.* from public.list_procedure_returns_v2() pr where pr.patient_id=p_patient_id
  ),
  events as(
    select 'appointment:'||a.id::text||':created' as event_key,'appointment'::text as event_type,a.created_at as occurred_at,'Consulta agendada'::text as title,
      coalesce(s.name,'Consulta')||' · para '||to_char(timezone('America/Sao_Paulo',a.scheduled_at),'DD/MM/YYYY HH24:MI') as subtitle,a.id as source_id,
      jsonb_build_object('scheduled_at',a.scheduled_at,'status',a.status) as metadata
    from public.appointments a left join public.services s on s.id=a.service_id and s.user_id=v_uid
    where a.user_id=v_uid and a.patient_id=p_patient_id

    union all
    select 'appointment:'||a.id::text||':confirmed','appointment',a.confirmed_at,'Consulta confirmada',
      coalesce(s.name,'Consulta')||' · '||to_char(timezone('America/Sao_Paulo',a.scheduled_at),'DD/MM/YYYY HH24:MI'),a.id,
      jsonb_build_object('scheduled_at',a.scheduled_at,'status',a.status)
    from public.appointments a left join public.services s on s.id=a.service_id and s.user_id=v_uid
    where a.user_id=v_uid and a.patient_id=p_patient_id and a.confirmed_at is not null

    union all
    select 'appointment:'||a.id::text||':canceled','appointment',a.canceled_at,'Consulta cancelada',
      coalesce(s.name,'Consulta')||coalesce(' · '||nullif(a.cancellation_reason,''),''),a.id,
      jsonb_build_object('scheduled_at',a.scheduled_at,'status',a.status)
    from public.appointments a left join public.services s on s.id=a.service_id and s.user_id=v_uid
    where a.user_id=v_uid and a.patient_id=p_patient_id and a.canceled_at is not null

    union all
    select 'appointment:'||a.id::text||':no-show','appointment',a.no_show_at,'Não compareceu',
      coalesce(s.name,'Consulta')||' · '||to_char(timezone('America/Sao_Paulo',a.scheduled_at),'DD/MM/YYYY HH24:MI'),a.id,
      jsonb_build_object('scheduled_at',a.scheduled_at,'status',a.status)
    from public.appointments a left join public.services s on s.id=a.service_id and s.user_id=v_uid
    where a.user_id=v_uid and a.patient_id=p_patient_id and a.no_show_at is not null

    union all
    select 'procedure:'||p.id::text,'procedure',p.performed_at,'Atendimento realizado',
      coalesce((select string_agg(pi.name,' + ' order by pi.created_at,pi.id) from public.procedure_items pi where pi.user_id=v_uid and pi.procedure_id=p.id),'Atendimento'),
      p.id,jsonb_build_object('total_value',p.total_value,'pending_amount',p.pending_amount)
    from public.procedures p where p.user_id=v_uid and p.patient_id=p_patient_id

    union all
    select 'return:'||pr.id::text||':created','return',pr.created_at,
      case when pr.return_type='next_session' then 'Próxima sessão prevista' else 'Retorno gerado' end,
      pr.service_name||' · '||to_char(pr.window_start,'DD/MM')||'–'||to_char(pr.window_end,'DD/MM'),pr.id,
      jsonb_build_object('procedure_id',pr.procedure_id,'window_start',pr.window_start,'window_end',pr.window_end)
    from return_rows pr

    union all
    select 'return:'||pr.id::text||':contacted','return',pr.contacted_at,'Retorno contatado',pr.service_name,pr.id,jsonb_build_object('contact_method',pr.contact_method)
    from return_rows pr where pr.contacted_at is not null

    union all
    select 'return:'||pr.id::text||':completed','return',pr.completed_at,'Retorno concluído',pr.service_name,pr.id,jsonb_build_object('completed_by_procedure_id',pr.completed_by_procedure_id)
    from return_rows pr where pr.completed_at is not null

    union all
    select 'return:'||pr.id::text||':dismissed','return',pr.dismissed_at,'Retorno dispensado',pr.service_name||coalesce(' · '||nullif(pr.dismissed_reason,''),''),pr.id,'{}'::jsonb
    from return_rows pr where pr.dismissed_at is not null

    union all
    select 'note:'||n.id::text,'note',n.created_at,'Nota criada',left(n.content,120),n.id,jsonb_build_object('remind_at',n.remind_at,'resolved',n.resolved)
    from public.patient_notes n where n.user_id=v_uid and n.patient_id=p_patient_id

    union all
    select 'contract:'||c.id::text,'contract',c.signed_at,'Contrato assinado',coalesce(ct.name,'Contrato'),c.id,jsonb_build_object('template_id',c.template_id)
    from public.contracts c left join public.contract_templates ct on ct.id=c.template_id and ct.user_id=v_uid
    where c.user_id=v_uid and c.patient_id=p_patient_id

    union all
    select
      'photo-session:'||ps.id::text,
      'photo',
      ps.captured_at,
      'Nova sessão fotográfica',
      coalesce(ps.service_name_snapshot,
        case ps.session_type when 'baseline' then 'Inicial' when 'pre_procedure' then 'Antes' when 'immediate_post' then 'Depois imediato' when 'followup' then 'Retorno' when 'progress' then 'Evolução' else 'Sessão fotográfica' end
      )||' · '||count(ph.id)::text||case when count(ph.id)=1 then ' foto' else ' fotos' end,
      ps.id,
      jsonb_build_object('session_type',ps.session_type,'appointment_id',ps.appointment_id,'procedure_id',ps.procedure_id,'service_id',ps.service_id,'photo_count',count(ph.id))
    from public.patient_photo_sessions ps
    join public.patient_photos ph on ph.photo_session_id=ps.id and ph.user_id=v_uid and ph.voided_at is null
    where ps.user_id=v_uid and ps.patient_id=p_patient_id and ps.voided_at is null
    group by ps.id

    union all
    select 'photo:'||ph.id::text,'photo',ph.taken_at,'Foto registrada',
      coalesce(nullif(ph.label,''),case ph.photo_type when 'before' then 'Antes' when 'after' then 'Depois' else 'Foto clínica' end),ph.id,
      jsonb_build_object('photo_type',ph.photo_type,'procedure_id',ph.procedure_id,'legacy',true)
    from public.patient_photos ph
    where ph.user_id=v_uid and ph.patient_id=p_patient_id and ph.photo_session_id is null and ph.voided_at is null

    union all
    select 'anamnesis:'||a.id::text,'anamnesis',a.updated_at,'Anamnese atualizada',null::text,a.id,'{}'::jsonb
    from public.anamnesis a where a.user_id=v_uid and a.patient_id=p_patient_id

    union all
    select 'injectable:'||im.id::text,'injectable',im.created_at,'Mapa de injetáveis registrado',null::text,im.id,jsonb_build_object('procedure_id',im.procedure_id)
    from public.injectable_maps im where im.user_id=v_uid and im.patient_id=p_patient_id
  )
  select e.event_key,e.event_type,e.occurred_at,e.title,e.subtitle,e.source_id,e.metadata
  from events e
  where e.occurred_at is not null
    and (p_cursor_at is null or e.occurred_at<p_cursor_at or (e.occurred_at=p_cursor_at and e.event_key<coalesce(p_cursor_key,'')))
  order by e.occurred_at desc,e.event_key desc
  limit v_limit;
end;
$$;

revoke all on function public.list_patient_timeline_v1(uuid,integer,timestamptz,text) from public,anon;
grant execute on function public.list_patient_timeline_v1(uuid,integer,timestamptz,text) to authenticated;
