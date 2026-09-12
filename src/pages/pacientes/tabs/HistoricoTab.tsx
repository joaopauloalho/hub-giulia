import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, ChevronRight, ClipboardList, Clock3, FileText, Loader2, MapPin, Pencil, Plus, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useProcedures } from '../../../hooks/useProcedures';
import { useContracts } from '../../../hooks/useContracts';
import { useTreatmentSessions, type TreatmentSessionRecord } from '../../../hooks/useTreatmentSessions';
import { useToast } from '../../../hooks/useToast';
import { getProcedureFinancials, procedureServiceNames } from '../../../lib/financeIntegrity';
import { supabase } from '../../../lib/supabase';
import type { Contract, Procedure, ProcedurePayment } from '../../../types';

interface Props {
  patientId: string;
  onPhotos?: () => void;
  onInjectables?: () => void;
  onContract?: (procedureId: string) => void;
}

type ClinicalProcedure = Procedure & {
  attendance_type?: 'procedure' | 'return';
  parent_procedure_id?: string | null;
};

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Crédito', cartao_debito: 'Débito', pix_parcelado: 'PIX parcelado', split: 'Pagamento dividido',
};
const CONTRACT_STATUS: Record<Contract['status'], string> = { draft: 'Rascunho', ready: 'Aguardando assinatura', signed: 'Assinado', voided: 'Anulado' };
const currency = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function paymentLabel(payment: ProcedurePayment) {
  const base = PAYMENT_LABELS[payment.method] ?? payment.method;
  return payment.method === 'cartao_credito' && payment.installments > 1 ? `${base} ${payment.installments}x` : base;
}

function sessionLabel(session: TreatmentSessionRecord) {
  const start = Number(session.session_start);
  const end = Number(session.session_end);
  const total = Number(session.session_total);
  const fmt = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return Math.abs(start - end) < .001 ? `Sessão ${fmt(end)} de ${fmt(total)}` : `Sessões ${fmt(start)}–${fmt(end)} de ${fmt(total)}`;
}

function clinicalTimeLabel(minutes: number) {
  const normalized = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}

function ProcedureCard({ proc, contracts, treatmentSessions, settlingPaymentId, onReceive, onPhotos, onInjectables, onContract, onReturn, onEdit }: {
  proc: ClinicalProcedure;
  contracts: Contract[];
  treatmentSessions: TreatmentSessionRecord[];
  settlingPaymentId: string | null;
  onReceive: (payment: ProcedurePayment) => void;
  onPhotos?: () => void;
  onInjectables?: () => void;
  onContract?: (procedureId: string) => void;
  onReturn?: (procedureId: string) => void;
  onEdit?: (procedureId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const finance = getProcedureFinancials(proc);
  const items = proc.items ?? [];
  const payments = [...(proc.payments ?? [])].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  const treatmentByItem = new Map(treatmentSessions.map(session => [session.procedure_item_id_snapshot, session]));
  const isReturn = proc.attendance_type === 'return';
  const isTreatmentOnly = !isReturn && treatmentSessions.length > 0 && finance.venda <= .01 && payments.length === 0;
  const isCourtesyOnly = !isReturn && !isTreatmentOnly && String(proc.payment_method) === 'cortesia' && finance.venda <= .01;
  const clinicalMinutes = Number(proc.clinical_minutes ?? 0);
  const clinicalTimeCost = Number(proc.clinical_time_cost ?? 0);
  const clinicalHourlyRate = Number(proc.clinical_hourly_rate_snapshot ?? 0);
  const totalCost = Number(proc.total_cost ?? 0);
  const otherCosts = Math.max(0, totalCost - clinicalTimeCost);
  const hasClinicalCostSnapshot = Boolean(proc.clinical_cost_applied);

  return <div className="card" style={{ overflow: 'hidden', marginBottom: 8, borderColor: isReturn ? '#bbf7d0' : undefined }}>
    <button type="button" onClick={() => setOpen(value => !value)} style={{ width: '100%', minHeight: 68, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: isReturn ? '#f8fff9' : 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: isReturn || isTreatmentOnly ? '#f0fdf4' : isCourtesyOnly ? '#fdf2f8' : 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{isReturn ? <RotateCcw size={18} style={{ color: '#166534' }}/> : <ClipboardList size={18} style={{ color: isTreatmentOnly ? '#166534' : isCourtesyOnly ? '#9d174d' : 'var(--primary)' }} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem' }}>{format(parseISO(proc.performed_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}</div>
        <div className="page-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{procedureServiceNames(proc)}</div>
        {isReturn && <span className="badge badge--green" style={{ marginTop: 5 }}><RotateCcw size={11}/> RETORNO</span>}
        {!isReturn && treatmentSessions.length > 0 && <span className="badge badge--green" style={{ marginTop: 5 }}>{treatmentSessions[0].package_title}</span>}
        {isCourtesyOnly && <span className="badge" style={{ marginTop: 5, background: '#fce7f3', color: '#9d174d' }}>BRINDE / CORTESIA</span>}
        {!isReturn && finance.pendente > 0 && <span className="badge badge--amber" style={{ marginTop: 5 }}>A RECEBER · {currency(finance.pendente)}</span>}
        {clinicalMinutes > 0 && <span className="badge" style={{ marginTop: 5, background: 'var(--bg-2)', color: 'var(--text-2)' }}><Clock3 size={11}/> {clinicalTimeLabel(clinicalMinutes)} clínicos</span>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {isReturn ? <><strong style={{ color: '#166534', fontSize: 13 }}>Sem cobrança</strong><div className="page-sub">custo {currency(totalCost)}</div></> : isTreatmentOnly ? <><strong style={{ color: '#166534', fontSize: 13 }}>Já pago</strong><div className="page-sub">sessão do tratamento</div></> : isCourtesyOnly ? <><strong style={{ color: '#9d174d', fontSize: 13 }}>Brinde</strong><div className="page-sub">sem cobrança</div></> : <><strong style={{ color: 'var(--primary)' }}>{currency(finance.venda)}</strong><div className="page-sub">recebido {currency(finance.pago)}</div></>}
      </div>
      <ChevronRight size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
    </button>

    {open && <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--border)', display: 'grid', gap: 14 }}>
      {isReturn && <div style={{ padding: 10, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 12 }}><strong>Retorno clínico vinculado.</strong> Não gerou nova cobrança para a paciente.</div>}
      <section>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Realizado neste atendimento</strong>
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          {items.length > 0 ? items.map(item => {
            const session = treatmentByItem.get(item.id);
            const courtesy = !isReturn && !session && Number(item.final_price) * Number(item.qty) <= .01 && Number(item.list_price) > .01;
            return <div key={item.id} style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13 }}>{item.qty > 1 ? `${item.qty}× ` : ''}{item.name}{session && <span style={{ display: 'block', color: '#166534', fontSize: 11, fontWeight: 700, marginTop: 2 }}>{sessionLabel(session)} · {session.package_title}</span>}{courtesy && <span style={{ display: 'block', color: '#9d174d', fontSize: 11, fontWeight: 800, marginTop: 2 }}>BRINDE / CORTESIA</span>}</span>
              {isReturn ? <span style={{ fontSize: 11, fontWeight: 800, color: '#166534', whiteSpace: 'nowrap' }}>SEM COBRANÇA</span> : session ? <span style={{ fontSize: 11, fontWeight: 800, color: '#166534', whiteSpace: 'nowrap' }}>JÁ PAGO</span> : courtesy ? <span style={{ fontSize: 11, fontWeight: 800, color: '#9d174d', whiteSpace: 'nowrap' }}>R$ 0,00</span> : <strong style={{ fontSize: 13 }}>{currency(item.final_price * item.qty)}</strong>}
            </div>;
          }) : <span className="page-sub">Snapshots detalhados não disponíveis neste registro legado.</span>}
        </div>
      </section>

      <section>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Financeiro deste atendimento</strong>
        <div style={{ display: 'grid', gap: 9, marginTop: 8 }}>
          {isReturn ? <div style={{ padding: 10, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 12 }}><strong>R$ 0,00 para a paciente.</strong> O pagamento permanece somente no atendimento original.</div> : payments.length > 0 ? payments.map(payment => <div key={payment.id} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', padding: payment.paid_at ? 0 : 9, borderRadius: 9, background: payment.paid_at ? 'transparent' : '#fffbeb', border: payment.paid_at ? 'none' : '1px solid #fde68a' }}><div><span style={{ fontSize: 13 }}>{paymentLabel(payment)}</span><div className="page-sub">{payment.paid_at ? `Recebido em ${new Date(payment.paid_at).toLocaleDateString('pt-BR')}` : payment.scheduled_date ? `A receber · previsto ${new Date(`${payment.scheduled_date}T12:00:00`).toLocaleDateString('pt-BR')}` : 'A receber'}</div></div><div style={{ textAlign: 'right' }}><strong style={{ display: 'block', fontSize: 13 }}>{currency(payment.amount)}</strong>{!payment.paid_at && <button type="button" className="btn btn--primary btn--sm" style={{ marginTop: 6, minHeight: 38 }} disabled={settlingPaymentId === payment.id} onClick={() => onReceive(payment)}>{settlingPaymentId === payment.id ? <Loader2 size={13} className="spin"/> : <CheckCircle2 size={13}/>} Registrar recebimento</button>}</div></div>) : treatmentSessions.length > 0 ? <div style={{ padding: 10, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 12 }}><strong>Nenhuma nova cobrança.</strong> O pagamento foi registrado na venda do tratamento.</div> : isCourtesyOnly ? <div style={{ padding: 10, borderRadius: 9, background: '#fdf2f8', border: '1px solid #fbcfe8', color: '#9d174d', fontSize: 12 }}><strong>Brinde/cortesia.</strong> Este atendimento foi registrado sem cobrança.</div> : <span className="page-sub">Nenhum pagamento detalhado disponível.</span>}
        </div>
      </section>

      {!isReturn && !isTreatmentOnly && !isCourtesyOnly && <section style={{ display: 'grid', gap: 5 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="page-sub">Valor do atendimento</span><strong>{currency(finance.venda)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="page-sub">Recebido</span><strong>{currency(finance.pago)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="page-sub">A receber</span><strong style={{ color: finance.pendente > 0 ? '#b45309' : 'inherit' }}>{currency(finance.pendente)}</strong></div></section>}

      {hasClinicalCostSnapshot && <section style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-2)' }}><strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Custos do atendimento</strong><div style={{ display: 'grid', gap: 6, marginTop: 9 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span className="page-sub">Procedimentos, produtos e materiais</span><strong>{currency(otherCosts)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span className="page-sub">Tempo clínico · {clinicalTimeLabel(clinicalMinutes)}{clinicalHourlyRate > 0 ? ` × ${currency(clinicalHourlyRate)}/h` : ''}</span><strong>{currency(clinicalTimeCost)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingTop: 7, borderTop: '1px solid var(--border)' }}><strong>Custo total</strong><strong style={{ color: 'var(--primary)' }}>{currency(totalCost)}</strong></div></div></section>}

      {!isReturn && <section><strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Documentos</strong><div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{contracts.length > 0 ? contracts.map(contract => <div key={contract.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}><div><span style={{ fontSize: 13 }}>{contract.document_name_snapshot ?? contract.template?.name ?? 'Contrato'}</span><div className="page-sub">{CONTRACT_STATUS[contract.status]}</div></div>{contract.pdf_download_url && <a className="btn btn--ghost btn--sm" href={contract.pdf_download_url} target="_blank" rel="noopener noreferrer">Abrir PDF</a>}</div>) : <span className="page-sub">Nenhum documento vinculado a este atendimento.</span>}</div></section>}

      {proc.notes && <section><strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>{isReturn ? 'Resumo do retorno' : 'Observações'}</strong><p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{proc.notes}</p></section>}
      {proc.appointment_id && <div className="page-sub">Originado do agendamento {proc.appointment_id.slice(0, 8)}…</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onEdit && <button className="btn btn--primary btn--sm" onClick={() => onEdit(proc.id)}><Pencil size={14}/> Editar atendimento</button>}
        {!isReturn && onContract && <button className="btn btn--secondary btn--sm" onClick={() => onContract(proc.id)}><FileText size={14} /> Gerar documento</button>}
        {onPhotos && <button className="btn btn--ghost btn--sm" onClick={onPhotos}><Camera size={14} /> Fotos</button>}
        {onInjectables && <button className="btn btn--ghost btn--sm" onClick={onInjectables}><MapPin size={14} /> Injetáveis</button>}
        {!isReturn && onReturn && <button className="btn btn--secondary btn--sm" onClick={() => onReturn(proc.id)}><RotateCcw size={14}/> Registrar retorno</button>}
      </div>
    </div>}
  </div>;
}

export function HistoricoTab({ patientId, onPhotos, onInjectables, onContract }: Props) {
  const navigate = useNavigate();
  const { toast, confirm } = useToast();
  const { procedures, loading, error, refresh } = useProcedures(patientId);
  const { contracts, load: loadContracts } = useContracts(patientId);
  const { sessions: treatmentSessions, loading: loadingSessions } = useTreatmentSessions(patientId);
  const [settlingPaymentId, setSettlingPaymentId] = useState<string | null>(null);
  const clinicalProcedures = procedures as ClinicalProcedure[];
  const total = useMemo(() => clinicalProcedures.reduce((sum, proc) => sum + getProcedureFinancials(proc).venda, 0), [clinicalProcedures]);
  const pending = useMemo(() => clinicalProcedures.reduce((sum, proc) => sum + getProcedureFinancials(proc).pendente, 0), [clinicalProcedures]);
  const contractsByProcedure = useMemo(() => { const map = new Map<string, Contract[]>(); for (const contract of contracts) { if (!contract.procedure_id) continue; map.set(contract.procedure_id, [...(map.get(contract.procedure_id) ?? []), contract]); } return map; }, [contracts]);
  const sessionsByProcedure = useMemo(() => { const map = new Map<string, TreatmentSessionRecord[]>(); for (const session of treatmentSessions) map.set(session.procedure_id_snapshot, [...(map.get(session.procedure_id_snapshot) ?? []), session]); return map; }, [treatmentSessions]);
  const ids = useMemo(() => new Set(clinicalProcedures.map(proc => proc.id)), [clinicalProcedures]);
  const roots = useMemo(() => clinicalProcedures.filter(proc => !proc.parent_procedure_id || !ids.has(proc.parent_procedure_id)), [clinicalProcedures, ids]);
  const childrenByParent = useMemo(() => { const map = new Map<string, ClinicalProcedure[]>(); for (const proc of clinicalProcedures) { if (!proc.parent_procedure_id || !ids.has(proc.parent_procedure_id)) continue; map.set(proc.parent_procedure_id, [...(map.get(proc.parent_procedure_id) ?? []), proc]); } for (const rows of map.values()) rows.sort((a, b) => a.performed_at.localeCompare(b.performed_at)); return map; }, [clinicalProcedures, ids]);

  useEffect(() => { void loadContracts(); }, [loadContracts]);

  const receivePayment = async (payment: ProcedurePayment) => {
    const ok = await confirm({ title: 'Registrar recebimento', message: `Confirmar o recebimento de ${currency(payment.amount)} via ${paymentLabel(payment)}?` });
    if (!ok) return;
    setSettlingPaymentId(payment.id);
    try {
      const { error: updateError } = await supabase.from('procedure_payments').update({ paid_at: new Date().toISOString() }).eq('id', payment.id).is('paid_at', null);
      if (updateError) throw updateError;
      await refresh();
      toast.success('Recebimento registrado.');
    } catch (receiveError) {
      console.error('[attendance:receive-payment]', receiveError);
      toast.error('Não foi possível registrar o recebimento.');
    } finally { setSettlingPaymentId(null); }
  };

  const newAttendanceButton = <button type="button" className="btn btn--primary btn--md" style={{ minHeight: 44 }} onClick={() => navigate(`/registrar?patientId=${encodeURIComponent(patientId)}`)}><Plus size={16}/> Novo atendimento</button>;
  const renderCard = (proc: ClinicalProcedure) => <ProcedureCard key={proc.id} proc={proc} contracts={contractsByProcedure.get(proc.id) ?? []} treatmentSessions={sessionsByProcedure.get(proc.id) ?? []} settlingPaymentId={settlingPaymentId} onReceive={payment => void receivePayment(payment)} onPhotos={onPhotos} onInjectables={onInjectables} onContract={onContract} onReturn={procedureId => navigate(`/registrar?return_of=${encodeURIComponent(procedureId)}`)} onEdit={procedureId => navigate(`/registrar?edit=${encodeURIComponent(procedureId)}`)}/>;

  if (error) return <div><div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>{newAttendanceButton}</div><div className="empty-state" style={{ padding: '48px 20px' }}><p>{error}</p></div></div>;
  if (loading || loadingSessions) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} /></div>;

  return <div style={{ padding: '0 0 16px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border)', flexWrap: 'wrap' }}><div><span className="page-sub">{clinicalProcedures.length} atendimento{clinicalProcedures.length !== 1 ? 's' : ''}</span><div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}><strong style={{ color: 'var(--primary)', fontSize: 13 }}>Total: {currency(total)}</strong>{pending > .01 && <strong style={{ color: '#b45309', fontSize: 13 }}>A receber: {currency(pending)}</strong>}</div></div>{newAttendanceButton}</div>
    {clinicalProcedures.length === 0 ? <div className="empty-state" style={{ padding: '48px 20px' }}><ClipboardList size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} /><p>Nenhum atendimento realizado.</p><button type="button" className="btn btn--primary btn--md" style={{ marginTop: 10, minHeight: 44 }} onClick={() => navigate(`/registrar?patientId=${encodeURIComponent(patientId)}`)}><Plus size={16}/> Criar primeiro atendimento</button></div> : roots.map(root => <div key={root.id} style={{ marginBottom: 12 }}>{renderCard(root)}{(childrenByParent.get(root.id) ?? []).length > 0 && <div style={{ marginLeft: 26, paddingLeft: 12, borderLeft: '2px solid #bbf7d0' }}><div className="page-sub" style={{ margin: '4px 0 7px', color: '#166534', fontWeight: 700 }}>Retornos deste atendimento</div>{(childrenByParent.get(root.id) ?? []).map(renderCard)}</div>}</div>)}
  </div>;
}
