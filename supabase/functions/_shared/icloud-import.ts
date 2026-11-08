import { createAdminClient, HttpError } from './google-calendar-security.ts';
import { readCalendar } from './icloud-caldav.ts';

type AdminClient = ReturnType<typeof createAdminClient>;
export type ImportResult = {
  imported: number;
  removed_from_icloud: number;
  calendars_checked: number;
  last_sync_at: string;
  mode: 'read_only';
};

export async function syncIcloudUser(admin: AdminClient, userId: string): Promise<ImportResult> {
  const { data: account, error: accountError } = await admin.from('icloud_calendar_accounts')
    .select('apple_id,connected').eq('user_id',userId).maybeSingle();
  if (accountError || !account?.connected)
    throw new HttpError(409,'icloud_not_connected','Conecte o iCloud antes de sincronizar.');

  const { data: password, error: secretError } =
    await admin.rpc('icloud_vault_read_v1',{p_user:userId});
  if (secretError || !password)
    throw new HttpError(409,'icloud_secret_unavailable','A credencial do iCloud precisa ser reconectada.');

  const { data: calendars, error: collectionError } = await admin.from('icloud_calendar_collections')
    .select('calendar_id,calendar_url').eq('user_id',userId).eq('is_selected',true);
  if (collectionError)
    throw new HttpError(500,'icloud_collections_failed','Nao foi possivel carregar os calendarios.');

  const now = Date.now();
  const from = new Date(now - 180*86400000);
  const to = new Date(now + 540*86400000);
  const seen = new Date().toISOString();
  let imported=0, removed=0;
  for (const calendar of calendars ?? []) {
    // Query the entire period before touching imported records: failed REPORT
    // must never result in an empty set being mistaken for deleted Apple events.
    const events=await readCalendar(account.apple_id,password,calendar.calendar_url,from,to);
    for(let i=0;i<events.length;i+=150) {
      const {error}=await admin.rpc('ingest_icloud_events_v2',{
        p_user:userId,
        p_calendar_id:calendar.calendar_id,
        p_events:events.slice(i,i+150),
        p_seen_at:seen,
      });
      if(error)throw new HttpError(500,'icloud_import_failed',
        'Falha ao salvar compromissos do iCloud. Nenhum atendimento foi apagado.');
    }
    // Reconcile only after all batches succeeded; soft-deleted rows retain their
    // patient/appointment links for clinic history and review.
    const {data:removedCount,error:finishError}=await admin.rpc('finish_icloud_calendar_sync_v2',{
      p_user:userId,p_calendar_id:calendar.calendar_id,p_seen_at:seen,
      p_from:from.toISOString(),p_to:to.toISOString(),
    });
    if(finishError)throw new HttpError(500,'icloud_sync_finalize_failed',
      'A sincronizacao nao conseguiu conferir eventos removidos no iPhone.');
    imported+=events.length;
    removed+=Number(removedCount ?? 0);
    const {error:updateError}=await admin.from('icloud_calendar_collections')
      .update({last_sync_at:seen}).eq('user_id',userId)
      .eq('calendar_id',calendar.calendar_id);
    if(updateError)throw new HttpError(500,'icloud_sync_progress_failed',
      'Nao foi possivel registrar a ultima atualizacao.');
  }
  const {error:statusError}=await admin.from('icloud_calendar_accounts').update({
    last_sync_at:seen,last_error_code:null,updated_at:seen,
  }).eq('user_id',userId);
  if(statusError)throw new HttpError(500,'icloud_sync_progress_failed',
    'Nao foi possivel concluir o controle de sincronizacao.');
  return {imported,removed_from_icloud:removed,
    calendars_checked:calendars?.length ?? 0,last_sync_at:seen,mode:'read_only'};
}
