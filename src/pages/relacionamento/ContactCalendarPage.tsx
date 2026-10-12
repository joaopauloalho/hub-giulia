import { useEffect, useMemo, useState } from 'react';
import { CakeSlice, ChevronLeft, ChevronRight, MessageCircle, RefreshCw, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildSafeWhatsAppUrl } from '../../lib/whatsapp';
import { clinicToday, listContactCalendar, setContactMarked, shiftDate, weekMonday, type ContactCalendarEvent } from '../../lib/contactCalendar';
import { useToast } from '../../hooks/useToast';
import './contact-calendar.css';

function shortDate(iso: string) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
function message(item: ContactCalendarEvent) {
  const name = item.patient_name.trim().split(/\s+/)[0];
  return item.kind === 'birthday'
    ? 'Oi, ' + name + '! Feliz aniversário! 🎉 Desejamos muita saúde e alegrias neste novo ciclo!'
    : 'Oi, ' + name + '! Tudo bem? Passando para saber como você está desde o procedimento de ' +
      (item.service_name ?? 'estética') + '. Se quiser conversar sobre próximos cuidados, estamos à disposição!';
}
export function ContactCalendarPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [today] = useState(clinicToday);
  const [monday, setMonday] = useState(() => weekMonday(clinicToday()));
  const [selected, setSelected] = useState<string>('all');
  const [items, setItems] = useState<ContactCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(monday, i)), [monday]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    void listContactCalendar(monday, shiftDate(monday, 6)).then(rows => {
      if (alive) setItems(rows);
    }).catch(reason => {
      if (alive) { setItems([]); setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.'); }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [monday, reload]);
  const changeWeek = (value: number) => { setMonday(shiftDate(monday, 7 * value)); setSelected('all'); };
  const mark = async (item: ContactCalendarEvent) => {
    if (busy) return;
    setBusy(item.item_key);
    try {
      const contacted_at = await setContactMarked(item, !item.contacted_at);
      setItems(current => current.map(row => row.item_key === item.item_key ? { ...row, contacted_at } : row));
      toast.success(contacted_at ? 'Contato registrado.' : 'Marcação retirada.');
    } catch (reason) { console.error('[contact-calendar]', reason); toast.error('Não foi possível salvar.'); }
    finally { setBusy(null); }
  };
  const openWhatsApp = (item: ContactCalendarEvent) => {
    const url = buildSafeWhatsAppUrl(item.phone, message(item));
    if (!url) { toast.error('WhatsApp não cadastrado ou inválido.'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const groups = days.filter(day => selected === 'all' || selected === day).map(day =>
    ({ day, entries: items.filter(item => item.event_date === day) }))
  .filter(group => selected !== 'all' || group.entries.length > 0);
  return <section className="contact-calendar" aria-label="Agenda semanal de contatos">
    <header className="contact-calendar-head"><div><h1>Agenda de contatos</h1><p className="page-sub">Só sugestões. Cada paciente fica no dia programado, sem pendências.</p></div>
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setMonday(weekMonday(today)); setSelected(today); }}>Hoje</button>
    </header>
    <div className="card contact-calendar-top">
      <div className="contact-calendar-navigation">
        <button type="button" className="icon-btn" aria-label="Semana anterior" onClick={() => changeWeek(-1)}><ChevronLeft size={19}/></button>
        <strong>{shortDate(monday)} — {shortDate(days[6])}</strong>
        <button type="button" className="icon-btn" aria-label="Próxima semana" onClick={() => changeWeek(1)}><ChevronRight size={19}/></button>
      </div>
      <div className="contact-calendar-days">{days.map((day, i) =>
        <button type="button" key={day} aria-pressed={selected === day}
          className={'contact-calendar-day' + (selected === day ? ' active' : '')}
          onClick={() => setSelected(day)}>
          <span>{['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'][i]}</span><strong>{day.slice(-2)}</strong>
          <small>{items.filter(item => item.event_date === day).length || '·'}</small>
        </button>)}</div>
      <div className="contact-calendar-meta">
        <button type="button" className={'btn btn--sm ' + (selected === 'all' ? 'btn--primary' : 'btn--ghost')} onClick={() => setSelected('all')}>Semana inteira</button>
        <span className="page-sub">{items.filter(item => item.kind === 'birthday').length} aniversários · {items.filter(item => item.kind === 'procedure').length} procedimentos</span>
      </div>
    </div>
    {error ? <div className="card contact-calendar-empty" role="alert"><strong>Agenda indisponível.</strong><p>{error}</p><button className="btn btn--secondary btn--sm" onClick={() => setReload(x => x + 1)}>Tentar novamente</button></div>
      : loading ? <div className="card contact-calendar-empty">Carregando sugestões…</div>
      : !groups.length ? <div className="card contact-calendar-empty">Nenhuma sugestão para a semana selecionada.</div>
      : groups.map(group => <div key={group.day} className="card contact-calendar-group">
        <header><strong>{group.day === today ? 'Hoje' : ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'][days.indexOf(group.day)]} · {shortDate(group.day)}</strong><span className="page-sub">{group.entries.length} sugestão(ões)</span></header>
        {group.entries.length === 0 ? <p className="page-sub">Sem sugestões neste dia.</p> :
          group.entries.map(item => <div className="contact-calendar-row" key={item.item_key}>
            <div className="contact-calendar-person">
              {item.kind === 'birthday' ? <CakeSlice size={18}/> : <RefreshCw size={18}/>}
              <div><strong>{item.patient_name}</strong><p className="page-sub">{item.kind === 'birthday' ? 'Aniversário' : 'Recontato · ' + item.service_name}</p>
                {item.contacted_at && <small className="page-sub">Contato registrado em {new Date(item.contacted_at).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}</small>}</div>
            </div>
            <div className="contact-calendar-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate('/pacientes/' + item.patient_id + '?return_to=' + encodeURIComponent('/relacionamento?view=calendar'))}><UserRound size={15}/> Ficha</button>
              <button type="button" className="btn btn--secondary btn--sm" disabled={!item.phone} onClick={() => openWhatsApp(item)}><MessageCircle size={15}/> WhatsApp</button>
              <label><input type="checkbox" checked={Boolean(item.contacted_at)} disabled={busy === item.item_key} onChange={() => void mark(item)}/> Contatei</label>
            </div>
          </div>)}
      </div>)}
    <p className="page-sub">O check é opcional e apenas registra sua confirmação. Abrir o WhatsApp não confirma o envio da mensagem.</p>
  </section>;
}
