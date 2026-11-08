-- Apply once to production after deploying icloud-calendar-hourly (verify_jwt=false).
-- The endpoint checks the 256-bit Vault token before touching account data.
-- The token is injected at execution time; it is never embedded in cron.job.
select cron.schedule(
  'hub-giulia-icloud-hourly',
  '0 * * * *',
  $job$
    select net.http_post(
      url := 'https://pvkrwjryvwsfwaxougyy.supabase.co/functions/v1/icloud-calendar-hourly',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-icloud-cron-token',
        (select decrypted_secret from vault.decrypted_secrets
           where name='hub_giulia_icloud_hourly_token' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
