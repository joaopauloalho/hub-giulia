begin;

create index treatment_proposals_deal_owner_idx
  on public.treatment_proposals(deal_id, user_id);

create index treatment_proposal_versions_proposal_owner_idx
  on public.treatment_proposal_versions(proposal_id, user_id);

create index treatment_proposal_versions_supersedes_owner_idx
  on public.treatment_proposal_versions(supersedes_version_id, user_id)
  where supersedes_version_id is not null;

create index treatment_proposal_items_version_owner_idx
  on public.treatment_proposal_items(proposal_version_id, user_id);

create index treatment_proposal_items_user_idx
  on public.treatment_proposal_items(user_id);

commit;
