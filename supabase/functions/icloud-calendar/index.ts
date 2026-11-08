import {
  HttpError, assertMethod, authenticate, createAdminClient, json, logSafe, preflight,
} from '../_shared/google-calendar-security.ts';
import {
  discoverCalendars, readCalendar,
} from '../_shared/icloud-caldav.ts';
import { syncIcloudUser } from '../_shared/icloud-import.ts';

type Command = {
  action?: 'status' | 'connect' | 'sync' | 'select' | 'disconnect' | 'check_conflict';
  starts_at?: string;
  ends_at?: string;
  ignore_appointment_id?: string;
  apple_id?: string;
  app_password?: string;
  calendar_id?: string;
  selected?: boolean;
};
const EMAIL = /^[^\s@]{1,200}@[^\s@]{1,100}\.[^\s@]{2,30}$/;
const MAX_BODY = 4096;

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    assertMethod(req, 'POST');
    const { user } = await authenticate(req);
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) {
      throw new HttpError(413, 'request_too_large', 'Pedido muito grande.');
    }
    let body: Command;
    try { body = await req.json(); }
    catch { throw new HttpError(400, 'invalid_body', 'Pedido invalido.'); }
    const admin = createAdminClient();

    if (body.action === 'status') {
      const [{ data: account, error: accountError }, { data: collections, error: listError }] =
        await Promise.all([
          admin.from('icloud_calendar_accounts')
            .select('connected,apple_id,write_enabled,write_calendar_id,last_sync_at,last_error_code')
            .eq('user_id',user.id).maybeSingle(),
          admin.from('icloud_calendar_collections')
            .select('calendar_id,display_name,is_selected,is_writable,last_sync_at')
            .eq('user_id',user.id).order('display_name'),
        ]);
      if (accountError || listError) throw new HttpError(500,'icloud_status_failed','Nao foi possivel consultar a conexao.');
      return json(req,{
        connected: Boolean(account?.connected),
        apple_id: account?.connected ? account.apple_id : null,
        write_enabled: Boolean(account?.connected && account?.write_enabled),
        write_calendar_id: account?.write_calendar_id ?? null,
        last_sync_at: account?.last_sync_at ?? null,
        last_error_code: account?.last_error_code ?? null,
        calendars: account?.connected ? collections ?? [] : [],
      });
    }

    if (body.action === 'connect') {
      const email = String(body.apple_id ?? '').trim();
      const password = String(body.app_password ?? '').trim();
      if (!EMAIL.test(email) || password.length < 12 || password.length > 128) {
        throw new HttpError(400,'icloud_credentials_invalid','Informe o e-mail Apple e a senha especifica de aplicativo.');
      }
      // Authenticate and discover before storing a credential or touching an existing link.
      const { home, calendars } = await discoverCalendars(email,password);
      const { data: secretId, error: secretError } = await admin.rpc('icloud_vault_store_v1', {
        p_user:user.id,p_password:password,
      });
      if (secretError || !secretId) throw new HttpError(500,'icloud_vault_failed','Nao foi possivel guardar a credencial com seguranca.');
      const { error: accountError } = await admin.from('icloud_calendar_accounts').upsert({
        user_id:user.id,
        apple_id:email,
        secret_id:secretId,
        calendar_home_url:home,
        connected:true,
        write_enabled:false,
        write_calendar_id:null,
        last_error_code:null,
        connected_at:new Date().toISOString(),
        updated_at:new Date().toISOString(),
      },{onConflict:'user_id'});
      if (accountError) throw new HttpError(500,'icloud_connection_store_failed','Nao foi possivel salvar a conexao.');
      for (const calendar of calendars) {
        const { error } = await admin.from('icloud_calendar_collections').upsert({
          user_id:user.id,...calendar,
        },{onConflict:'user_id,calendar_id'});
        if (error) throw new HttpError(500,'icloud_calendar_store_failed','Nao foi possivel salvar a lista de calendarios.');
      }
      return json(req,{connected:true,calendar_count:calendars.length,write_enabled:false});
    }

    if (body.action === 'disconnect') {
      const { error } = await admin.rpc('icloud_vault_revoke_v1',{p_user:user.id});
      if (error) throw new HttpError(500,'icloud_disconnect_failed','Nao foi possivel desconectar.');
      return json(req,{connected:false});
    }

    if (body.action === 'select') {
      const id = String(body.calendar_id ?? '');
      if (!id || typeof body.selected !== 'boolean') {
        throw new HttpError(400,'icloud_calendar_invalid','Selecione um calendario valido.');
      }
      const { data: collection } = await admin.from('icloud_calendar_collections')
        .select('calendar_id').eq('user_id',user.id).eq('calendar_id',id).maybeSingle();
      if (!collection) throw new HttpError(404,'icloud_calendar_not_found','Calendario indisponivel.');
      const { error } = await admin.from('icloud_calendar_collections')
        .update({is_selected:body.selected}).eq('user_id',user.id).eq('calendar_id',id);
      if (error) throw new HttpError(500,'icloud_calendar_select_failed','Nao foi possivel alterar o calendario.');
      return json(req,{selected:body.selected});
    }

    if (body.action === 'check_conflict') {
      const start = new Date(String(body.starts_at ?? ''));
      const end = new Date(String(body.ends_at ?? ''));
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
          || end <= start || end.getTime()-start.getTime() > 24 * 3600000) {
        throw new HttpError(400, 'icloud_invalid_range', 'Informe um horario valido para verificar.');
      }
      const { data: account, error: accountError } = await admin.from('icloud_calendar_accounts')
        .select('apple_id,connected').eq('user_id',user.id).maybeSingle();
      if (accountError) throw new HttpError(500, 'icloud_status_failed', 'Falha ao verificar o calendario.');
      if (!account?.connected) return json(req,{connected:false,checked:false,conflict:null});
      const { data: password, error: secretError } =
        await admin.rpc('icloud_vault_read_v1',{p_user:user.id});
      if (secretError || !password) throw new HttpError(409,'icloud_secret_unavailable',
        'A credencial do iCloud precisa ser reconectada.');
      const { data: calendars, error: calendarError } = await admin.from('icloud_calendar_collections')
        .select('calendar_id,calendar_url').eq('user_id',user.id).eq('is_selected',true);
      const { data: ownLink, error: linkError } = body.ignore_appointment_id
        ? await admin.from('icloud_appointment_links')
            .select('calendar_id,resource_href,recurrence_id')
            .eq('user_id',user.id).eq('appointment_id',body.ignore_appointment_id).maybeSingle()
        : {data:null,error:null};
      if (linkError) throw new HttpError(500,'icloud_link_failed',
        'Falha ao verificar o vinculo do agendamento.');
      if (calendarError) throw new HttpError(500,'icloud_collections_failed',
        'Falha ao carregar os calendarios.');
      for (const calendar of calendars ?? []) {
        const found = await readCalendar(account.apple_id,password,calendar.calendar_url,start,end);
        const hit = found.find(event =>
          !(ownLink && ownLink.calendar_id === calendar.calendar_id
             && ownLink.resource_href === event.resource_href
             && ownLink.recurrence_id === event.recurrence_id)
          && new Date(event.starts_at) < end && new Date(event.ends_at) > start);
        if (hit) return json(req,{connected:true,checked:true,conflict:{scheduled_at:hit.starts_at}});
      }
      return json(req,{connected:true,checked:true,conflict:null});
    }

    if (body.action === 'sync') {
      const result = await syncIcloudUser(admin,user.id);
      return json(req,result);
    }

    throw new HttpError(400,'action_invalid','Operacao nao suportada.');
  } catch (error) {
    const e = error instanceof HttpError ? error
      : new HttpError(500,'icloud_unknown_error','Nao foi possivel concluir a operacao no iCloud.');
    logSafe('icloud-calendar',e.code,e.status);
    return json(req,{error:e.code,message:e.message},e.status);
  }
});
