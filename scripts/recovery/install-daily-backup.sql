-- Hub Giulia 4.0 — daily verified recovery snapshot
-- Prerequisites (secret VALUES must never be committed):
--   vault secret: hub_giulia_backup_invoke_token
--   deployed production Edge Function: recovery-backup-v4
-- Schedule is UTC: 06:00 UTC = 03:00 America/Sao_Paulo.

select cron.unschedule(jobid)
from cron.job
where jobname = 'hub-giulia-daily-recovery-backup';

select cron.schedule(
  'hub-giulia-daily-recovery-backup',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://pvkrwjryvwsfwaxougyy.supabase.co/functions/v1/recovery-backup-v4',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-invoke-token',(select decrypted_secret from vault.decrypted_secrets where name='hub_giulia_backup_invoke_token' limit 1)
    ),
    body := '{"mode":"snapshot"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
