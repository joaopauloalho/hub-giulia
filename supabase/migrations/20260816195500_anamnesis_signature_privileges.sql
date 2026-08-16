-- Hub Giulia 3.9.1: explicit least-privilege grants for remote anamnesis signing.
-- Default schema privileges grant broader table capabilities; remove them explicitly.

revoke all privileges on table public.anamnesis_signature_links from anon, authenticated, service_role;
revoke all privileges on table public.anamnesis_signatures from anon, authenticated, service_role;

grant select on table public.anamnesis_signature_links to authenticated;
grant select on table public.anamnesis_signatures to authenticated;

grant select, insert, update on table public.anamnesis_signature_links to service_role;
grant select, insert on table public.anamnesis_signatures to service_role;
