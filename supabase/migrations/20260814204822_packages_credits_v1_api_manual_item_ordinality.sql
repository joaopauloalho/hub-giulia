-- Fix PostgreSQL WITH ORDINALITY use in manual package item creation.
create or replace function public.create_manual_package_v1(
  p_idempotency_key uuid, p_patient_id uuid, p_title text, p_source_type text, p_items jsonb,
  p_valid_from date default null, p_valid_until date default null, p_reason text default null, p_notes text default null
) returns public.patient_packages language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user_id uuid:=auth.uid(); v_package public.patient_packages; v_existing public.patient_packages; v_item_count integer; v_owned_count integer; v_total numeric(14,2);
begin
 if v_user_id is null then raise exception using errcode='P0001',message='PACKAGE_SESSION_REQUIRED'; end if;
 if p_idempotency_key is null then raise exception using errcode='22023',message='PACKAGE_IDEMPOTENCY_REQUIRED'; end if;
 if p_patient_id is null then raise exception using errcode='22023',message='PACKAGE_PATIENT_REQUIRED'; end if;
 if nullif(btrim(p_title),'') is null then raise exception using errcode='22023',message='PACKAGE_TITLE_REQUIRED'; end if;
 if p_source_type not in ('manual','complimentary') then raise exception using errcode='22023',message='PACKAGE_MANUAL_SOURCE_INVALID'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='PACKAGE_REASON_REQUIRED'; end if;
 if p_valid_until is not null and p_valid_from is not null and p_valid_until<p_valid_from then raise exception using errcode='22023',message='PACKAGE_VALIDITY_INVALID'; end if;
 if jsonb_typeof(coalesce(p_items,'null'::jsonb))<>'array' or jsonb_array_length(p_items)=0 then raise exception using errcode='22023',message='PACKAGE_ITEMS_REQUIRED'; end if;
 select * into v_existing from public.patient_packages where user_id=v_user_id and creation_idempotency_key=p_idempotency_key; if found then return v_existing; end if;
 perform 1 from public.patients where id=p_patient_id and user_id=v_user_id; if not found then raise exception using errcode='P0001',message='PACKAGE_PATIENT_FORBIDDEN'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric) where x.service_id is null or coalesce(x.quantity,0)<=0 or (x.commercial_value is not null and x.commercial_value<0)) then raise exception using errcode='22023',message='PACKAGE_ITEM_INVALID'; end if;
 select count(*) into v_item_count from jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric);
 if (select count(distinct x.service_id) from jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric))<>v_item_count then raise exception using errcode='22023',message='PACKAGE_DUPLICATE_SERVICE_ITEM'; end if;
 select count(*) into v_owned_count from public.services s join jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric) on x.service_id=s.id where s.user_id=v_user_id;
 if v_owned_count<>v_item_count then raise exception using errcode='P0001',message='PACKAGE_SERVICE_FORBIDDEN'; end if;
 select round(coalesce(sum(coalesce(x.commercial_value,s.price*x.quantity)),0),2) into v_total from jsonb_to_recordset(p_items) as x(service_id uuid,quantity numeric,commercial_value numeric) join public.services s on s.id=x.service_id and s.user_id=v_user_id;
 insert into public.patient_packages(user_id,patient_id,title_snapshot,source_type,status,commercial_total_snapshot,valid_from,valid_until,notes,creation_reason,creation_idempotency_key,created_by) values(v_user_id,p_patient_id,btrim(p_title),p_source_type,'draft',v_total,p_valid_from,p_valid_until,p_notes,btrim(p_reason),p_idempotency_key,v_user_id) returning * into v_package;
 insert into public.patient_package_items(user_id,package_id,service_id,service_name_snapshot,quantity_granted,unit_label_snapshot,commercial_value_snapshot,sort_order)
 select v_user_id,v_package.id,s.id,s.name,round((e.value->>'quantity')::numeric,3),'sessão',round(coalesce(nullif(e.value->>'commercial_value','')::numeric,s.price*(e.value->>'quantity')::numeric),2),e.ordinality::integer-1
 from jsonb_array_elements(p_items) with ordinality as e(value,ordinality)
 join public.services s on s.id=(e.value->>'service_id')::uuid and s.user_id=v_user_id;
 return v_package;
exception when unique_violation then select * into v_existing from public.patient_packages where user_id=v_user_id and creation_idempotency_key=p_idempotency_key; if found then return v_existing; end if; raise; end; $$;
revoke all on function public.create_manual_package_v1(uuid,uuid,text,text,jsonb,date,date,text,text) from public,anon;
grant execute on function public.create_manual_package_v1(uuid,uuid,text,text,jsonb,date,date,text,text) to authenticated;
