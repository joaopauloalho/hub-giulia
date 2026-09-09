-- Propostas são registros comerciais internos. Dados de conteúdo continuam editáveis
-- mesmo após envio/aceite/recusa, sem afrouxar identidade, status terminal ou PDF histórico.
create or replace function public.proposal_version_immutability_v1()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'draft' then
    if new.user_id is distinct from old.user_id
      or new.proposal_id is distinct from old.proposal_id
      or new.version_number is distinct from old.version_number
      or new.currency is distinct from old.currency
      or new.supersedes_version_id is distinct from old.supersedes_version_id
      or new.created_at is distinct from old.created_at
    then
      raise exception 'PROPOSAL_VERSION_IDENTITY_IMMUTABLE';
    end if;

    if old.status = 'accepted' and new.status <> 'accepted' then raise exception 'PROPOSAL_ACCEPTED_IMMUTABLE'; end if;
    if old.status = 'declined' and new.status <> 'declined' then raise exception 'PROPOSAL_DECLINED_IMMUTABLE'; end if;
    if old.status = 'voided' and new.status <> 'voided' then raise exception 'PROPOSAL_VOIDED_IMMUTABLE'; end if;
    if old.status = 'issued' and new.status not in ('issued','accepted','declined','voided') then raise exception 'PROPOSAL_INVALID_STATUS_TRANSITION'; end if;
    if old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path then raise exception 'PROPOSAL_PDF_IMMUTABLE'; end if;
    if old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256 then raise exception 'PROPOSAL_PDF_IMMUTABLE'; end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
