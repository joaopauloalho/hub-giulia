import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type IcloudCollection = {
  calendar_id: string; display_name: string; is_selected: boolean;
  is_writable: boolean; last_sync_at: string | null;
};
type IcloudStatus = {
  connected: boolean;
  apple_id: string | null;
  write_enabled: boolean;
  last_sync_at: string | null;
  calendars: IcloudCollection[];
};

async function callIcloud(action: string, extras: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('icloud-calendar', {
    body: { action, ...extras },
  });
  if (error) {
    const context = (error as { context?: Response }).context;
    const body = context && typeof context.json === 'function'
      ? await context.clone().json().catch(() => null) as { message?: string } | null
      : null;
    throw new Error(body?.message || 'Falha na conexao com o iCloud. Confira a conexao ou tente novamente.');
  }
  return data as Record<string, unknown>;
}

export function IcloudConnectionPanel({ onImported }: { onImported: () => void }) {
  const [status, setStatus] = useState<IcloudStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [appleId, setAppleId] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await callIcloud('status') as unknown as IcloudStatus;
      setStatus(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel carregar a integracao.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null); setMessage(null);
    try { await operation(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha no iCloud.'); }
    finally { setBusy(false); }
  };

  const connect = () => void run(async () => {
    await callIcloud('connect',{ apple_id:appleId.trim(), app_password:appPassword });
    setAppPassword('');
    setShowConnect(false);
    setMessage('Conta conectada! Agora importe os calendarios.');
    await refresh();
  });
  const sync = () => void run(async () => {
    const result = await callIcloud('sync');
    setMessage(`Importacao concluida: ${result.imported ?? 0} eventos encontrados em ${result.calendars_checked ?? 0} calendarios. Nenhum evento do iPhone foi alterado.`);
    onImported();
    await refresh();
  });
  const toggle = (calendar: IcloudCollection, selected: boolean) => void run(async () => {
    await callIcloud('select', { calendar_id:calendar.calendar_id,selected });
    await refresh();
  });
  const disconnect = () => void run(async () => {
    await callIcloud('disconnect');
    setMessage('Conta desconectada. Os compromissos ja importados continuam salvos no Hub.');
    await refresh();
  });

  return <section className="card" style={{padding:14,marginBottom:12}} aria-label="Integracao iCloud">
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <CalendarDays size={18}/><strong style={{flex:1}}>Calendario do iPhone · iCloud</strong>
      {status?.connected && <span style={{fontSize:12,color:'var(--primary)',fontWeight:700}}>
        <CheckCircle2 size={14} style={{display:'inline',verticalAlign:'middle'}}/> Conectado
      </span>}
    </div>
    {loading ? <p className="page-sub">Verificando conexao...</p> : status?.connected ? <>
      <p className="page-sub" style={{marginTop:6}}>
        Conta: {status.apple_id}. Seus eventos do iPhone permanecem intactos.
        {status.last_sync_at ? ` Ultima importacao: ${new Date(status.last_sync_at).toLocaleString('pt-BR')}.` : ' Ainda nao houve importacao.'}
      </p>
      <div style={{marginTop:12,display:'grid',gap:7}}>
        <strong style={{fontSize:13}}>Calendarios usados para avisos de conflito</strong>
        {status.calendars.map(calendar => <label key={calendar.calendar_id} style={{
          display:'flex',alignItems:'center',gap:10,fontSize:13, minHeight:36
        }}>
          <input type="checkbox" checked={calendar.is_selected} disabled={busy}
            onChange={event => toggle(calendar,event.target.checked)}/>
          <span style={{flex:1}}>{calendar.display_name}</span>
          {!calendar.is_writable && <span className="page-sub">Somente leitura</span>}
        </label>)}
      </div>
      <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy}
          onClick={sync}><RefreshCw size={15}/> {busy ? 'Processando...' : 'Importar / atualizar'}</button>
        <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
          onClick={disconnect}><Unplug size={15}/> Desconectar</button>
      </div>
      <p className="page-sub" style={{marginTop:9}}>
        Primeira etapa: leitura segura dos eventos. A escrita de novos agendamentos no iCloud
        sera ativada separadamente depois da revisao da importacao.
      </p>
    </> : <>
      <p className="page-sub" style={{marginTop:7}}>
        Conecte a Conta Apple com uma senha especifica de aplicativo. O Hub nunca exibe nem
        armazena a senha sem criptografia.
      </p>
      {!showConnect ? <button type="button" className="btn btn--primary btn--sm"
        style={{marginTop:10}} onClick={() => setShowConnect(true)}>
        <ShieldCheck size={15}/> Conectar iCloud
      </button> : <div style={{display:'grid',gap:8,marginTop:12}}>
        <label className="field-label">E-mail da Conta Apple</label>
        <input className="field-input" type="email" autoComplete="username"
          value={appleId} onChange={e=>setAppleId(e.target.value)} placeholder="conta@exemplo.com"/>
        <label className="field-label">Senha especifica do app (nao use sua senha Apple normal)</label>
        <input className="field-input" type="password" autoComplete="off"
          value={appPassword} onChange={e=>setAppPassword(e.target.value)} placeholder="••••-••••-••••-••••"/>
        <div style={{display:'flex',gap:8}}>
          <button type="button" className="btn btn--primary btn--sm"
            disabled={busy || !appleId.trim() || !appPassword.trim()} onClick={connect}>
            {busy ? 'Conectando...' : 'Conectar com seguranca'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm"
            disabled={busy} onClick={()=>{setShowConnect(false);setAppPassword('');}}>Cancelar</button>
        </div>
      </div>}
    </>}
    {message && <p role="status" style={{marginTop:10,fontSize:13,color:'var(--primary)'}}>{message}</p>}
    {error && <p role="alert" style={{marginTop:10,fontSize:13,color:'var(--red)'}}>{error}</p>}
  </section>;
}
