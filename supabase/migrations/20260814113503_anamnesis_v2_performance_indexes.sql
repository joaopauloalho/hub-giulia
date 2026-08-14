create index if not exists anamnesis_user_id_idx
  on public.anamnesis(user_id);

create index if not exists anamnesis_versions_author_idx
  on public.anamnesis_versions(author_user_id);

create index if not exists anamnesis_versions_supersedes_idx
  on public.anamnesis_versions(supersedes_version_id);
