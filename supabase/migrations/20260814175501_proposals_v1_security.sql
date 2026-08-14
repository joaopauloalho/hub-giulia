begin;

alter table public.treatment_proposals enable row level security;
alter table public.treatment_proposal_versions enable row level security;
alter table public.treatment_proposal_items enable row level security;

create policy treatment_proposals_select_own
on public.treatment_proposals for select to authenticated
using (user_id = (select auth.uid()));

create policy treatment_proposal_versions_select_own
on public.treatment_proposal_versions for select to authenticated
using (user_id = (select auth.uid()));

create policy treatment_proposal_items_select_own
on public.treatment_proposal_items for select to authenticated
using (user_id = (select auth.uid()));

revoke all on table public.treatment_proposals from public, anon, authenticated;
revoke all on table public.treatment_proposal_versions from public, anon, authenticated;
revoke all on table public.treatment_proposal_items from public, anon, authenticated;
grant select on table public.treatment_proposals to authenticated;
grant select on table public.treatment_proposal_versions to authenticated;
grant select on table public.treatment_proposal_items to authenticated;

revoke all on function public.create_treatment_proposal_v1(uuid,text,uuid) from public, anon;
revoke all on function public.save_treatment_proposal_draft_v1(uuid,bigint,text,date,text,text,text,text,numeric,jsonb) from public, anon;
revoke all on function public.issue_treatment_proposal_v1(uuid,bigint,uuid) from public, anon;
revoke all on function public.create_treatment_proposal_revision_v1(uuid,uuid) from public, anon;
revoke all on function public.mark_treatment_proposal_sent_v1(uuid,uuid) from public, anon;
revoke all on function public.accept_treatment_proposal_v1(uuid,boolean,uuid) from public, anon;
revoke all on function public.decline_treatment_proposal_v1(uuid,text,uuid) from public, anon;
revoke all on function public.void_treatment_proposal_v1(uuid,text,uuid) from public, anon;
revoke all on function public.attach_treatment_proposal_pdf_v1(uuid,text,text) from public, anon;

grant execute on function public.create_treatment_proposal_v1(uuid,text,uuid) to authenticated;
grant execute on function public.save_treatment_proposal_draft_v1(uuid,bigint,text,date,text,text,text,text,numeric,jsonb) to authenticated;
grant execute on function public.issue_treatment_proposal_v1(uuid,bigint,uuid) to authenticated;
grant execute on function public.create_treatment_proposal_revision_v1(uuid,uuid) to authenticated;
grant execute on function public.mark_treatment_proposal_sent_v1(uuid,uuid) to authenticated;
grant execute on function public.accept_treatment_proposal_v1(uuid,boolean,uuid) to authenticated;
grant execute on function public.decline_treatment_proposal_v1(uuid,text,uuid) to authenticated;
grant execute on function public.void_treatment_proposal_v1(uuid,text,uuid) to authenticated;
grant execute on function public.attach_treatment_proposal_pdf_v1(uuid,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('proposals','proposals',false,10485760,array['application/pdf']::text[])
on conflict (id) do update
set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy proposals_storage_select_own
on storage.objects for select to authenticated
using (
  bucket_id='proposals'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy proposals_storage_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id='proposals'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and lower(storage.extension(name)) = 'pdf'
);

commit;
