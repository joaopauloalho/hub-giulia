import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { buildSafeWhatsAppUrl } from '../../lib/whatsapp';
import { previewRows, type HojeRow } from '../../lib/hoje';
import { useHoje } from '../../hooks/useHoje';
import { useToast } from '../../hooks/useToast';
import { Skeleton } from '../../components/ui/Skeleton';
import '../simple/simple.css';

const SECTIONS = [
  { key: 'lancar', title: 'Lançar', hint: 'Visitas sem atendimento' },
  { key: 'chamar', title: 'Chamar', hint: 'Retorno, follow-up e aniversário' },
  { key: 'cobrar', title: 'Cobrar', hint: 'Pagamentos em aberto' },
] as const;

function formatToday(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function HojePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const expanded = searchParams.get('lista');
  const { today, loading, launch, call, charge, refresh } = useHoje();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const sections = { lancar: launch, chamar: call, cobrar: charge };

  const openRow = async (row: HojeRow) => {
    if (row.action === 'whatsapp') {
      const url = buildSafeWhatsAppUrl(row.phone, row.message ?? '');
      if (!url) {
        toast.error('Telefone inválido ou ausente.');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      if (!row.returnId) return;
      setBusyId(row.id);
      const { error } = await supabase.rpc('mark_procedure_return_contacted_v2', { p_return_id: row.returnId, p_method: 'whatsapp' });
      setBusyId(null);
      if (error) toast.error('WhatsApp aberto, mas o contato não ficou registrado.');
      else {
        toast.success('Contato registrado.');
        void refresh();
      }
      return;
    }
    if (row.href) navigate(row.href);
  };

  return <div className="page simple-page" data-testid="hoje-page">
    <header className="simple-head">
      <div>
        <h1 className="page-title">Hoje</h1>
        <p className="page-sub">{formatToday(today)}</p>
      </div>
      <Link className="btn btn--ghost btn--sm" to="/agenda">Agenda</Link>
    </header>
    {loading ? <div className="simple-list"><Skeleton height={72} /><Skeleton height={72} /><Skeleton height={72} /></div> : SECTIONS.map(section => {
      const data = sections[section.key];
      const shown = previewRows(data.rows, 5, expanded === section.key);
      return <section key={section.key} className="simple-section" aria-labelledby={`hoje-${section.key}`}>
        <div className="simple-section__head">
          <div>
            <h2 id={`hoje-${section.key}`}>{section.title}</h2>
            <p className="page-sub">{section.hint}</p>
          </div>
          {data.rows.length > 5 && expanded !== section.key && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSearchParams({ lista: section.key })}>Ver todos</button>}
          {expanded === section.key && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSearchParams({})}>Voltar</button>}
        </div>
        {data.error ? <div className="card simple-empty" role="alert">{data.error}</div> : shown.rows.length === 0 ? <div className="card simple-empty"><span className="page-sub">{section.key === 'lancar' ? 'Nada para lançar.' : section.key === 'chamar' ? 'Ninguém para chamar agora.' : 'Nada para cobrar.'}</span></div> : <div className="simple-list">
          {shown.rows.map(row => <article key={row.id} className="card simple-row">
            <div className="simple-row__body"><strong>{row.name}</strong><span className="page-sub">{row.detail}</span></div>
            <button type="button" className="btn btn--primary btn--sm" disabled={busyId === row.id} onClick={() => void openRow(row)}>{row.actionLabel}</button>
          </article>)}
        </div>}
        {section.key === 'chamar' && <p className="page-sub" style={{ marginTop: 8 }}><Link to="/aniversarios">Aniversários da semana</Link></p>}
      </section>;
    })}
    <p className="page-sub" style={{ marginTop: 28 }}><Link to="/dashboard">Desempenho do mês</Link></p>
  </div>;
}
