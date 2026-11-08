import { createAdminClient, HttpError } from '../_shared/google-calendar-security.ts';
import { syncIcloudUser } from '../_shared/icloud-import.ts';

const reply=(body:Record<string,unknown>,status=200) => new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
});

// This endpoint is *not* authenticated with a user JWT: it is only callable
// with the 256-bit token kept in Vault and attached by pg_cron + pg_net.
// Do not log tokens, Apple credentials, imported titles or patient data.
Deno.serve(async (req:Request) => {
  if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
  const token=req.headers.get('x-icloud-cron-token') ?? '';
  if(!/^[0-9a-f]{64}$/.test(token))return reply({error:'not_authorized'},401);
  const admin=createAdminClient();
  const {data:authorized,error:authError}=await admin.rpc(
    'verify_icloud_hourly_token_v1',{p_token:token});
  if(authError || authorized!==true)return reply({error:'not_authorized'},401);
  const {data:accounts,error:listError}=await admin.from('icloud_calendar_accounts')
    .select('user_id').eq('connected',true).order('user_id').limit(50);
  if(listError)return reply({error:'sync_account_list_failed'},500);
  let updated=0,failed=0,imported=0,removed=0;
  for(const account of accounts ?? []) {
    try {
      const result=await syncIcloudUser(admin,account.user_id);
      updated+=1;
      imported+=result.imported;
      removed+=result.removed_from_icloud;
    } catch(error) {
      failed+=1;
      const code=error instanceof HttpError ? error.code : 'icloud_sync_unexpected';
      await admin.from('icloud_calendar_accounts')
        .update({last_error_code:code,updated_at:new Date().toISOString()})
        .eq('user_id',account.user_id);
    }
  }
  return reply({accounts_checked:accounts?.length ?? 0,updated,failed,
    events_seen:imported,events_removed_from_icloud:removed});
});
