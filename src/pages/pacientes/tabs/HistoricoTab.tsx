import { useEffect, useMemo, useState } from 'react';
import { Camera, ChevronRight, ClipboardList, FileText, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useProcedures } from '../../../hooks/useProcedures';
import { useContracts } from '../../../hooks/useContracts';
import { useProcedureTraceability } from '../../../hooks/useProcedureTraceability';
import { getProcedureFinancials, procedureServiceNames } from '../../../lib/financeIntegrity';
import { formatTraceabilityExpiry } from '../../../lib/productTraceability';
import type { Contract, Procedure, ProcedurePayment } from '../../../types';
import type { ProcedureTraceabilityWithEvidence } from '../../../types/traceability';

interface Props {
  patientId: string;
  onPhotos?: () => void;
  onInjectables?: () => void;
  onContract?: (procedureId: string) => void;
}

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_credito: 'Crédito',
  cartao_debito: 'Débito',
  pix_parcelado: 'PIX parcelado',
};

const CONTRACT_STATUS: Record<Contract['status'], string> = {
  draft: 'Rascunho',
  ready: 'Aguardando assinatura',
  signed: 'Assinado',
  voided: 'Anulado',
};

function currency(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function paymentLabel(payment: ProcedurePayment) {
  const base = PAYMENT_LABELS[payment.method] ?? payment.method;
  if (payment.method === 'cartao_credito' && payment.installments > 1) return `${base} ${payment.installments}x`;
  return base;
}

function TraceabilitySection({ records }: { records: ProcedureTraceabilityWithEvidence[] }) {
  if (records.length === 0) return null;
  return <section>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={14} style={{ color: 'var(--primary)' }} /><strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Rastreabilidade do atendimento</strong></div>
    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      {records.map(record => <div key={record.id} style={{ padding: 11, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {record.evidence?.previewUrl && <img src={record.evidence.previewUrl} alt={`Rótulo de ${record.product_name_snapshot}`} style={{ width: 62, height: 62, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', flexShrink: 0 }} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 13 }}>{record.product_name_snapshot}</strong>{record.status !== 'active' && <span className="badge badge--amber">{record.status === 'reverted' ? 'Atendimento revertido' : 'Registro anulado'}</span>}</div>
            {(record.brand_snapshot || record.presentation_snapshot) && <div className="page-sub">{[record.brand_snapshot, record.presentation_snapshot].filter(Boolean).join(' · ')}</div>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 5, fontSize: 12 }}><span><strong>{record.quantity_snapshot.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</strong> {record.unit_snapshot}</span>{record.lot_number_snapshot && <span>Lote <strong>{record.lot_number_snapshot}</strong></span>}{record.expires_on_snapshot && <span>Validade <strong>{formatTraceabilityExpiry(record.expires_on_snapshot)}</strong></span>}{record.evidence && <span>📷 foto registrada</span>}</div>
            <div className="page-sub" style={{ marginTop: 5 }}>Registrado em {new Date(record.created_at).toLocaleString('pt-BR')}</div>
          </div>
        </div>
      </div>)}
    </div>
  </section>;
}

function ProcedureCard({ proc, contracts, traceability, onPhotos, onInjectables, onContract }: { proc: Procedure; contracts: Contract[]; traceability: ProcedureTraceabilityWithEvidence[]; onPhotos?: () => void; onInjectables?: () => void; onContract?: (procedureId: string) => void }) {
  const [open, setOpen] = useState(false);
  const finance = getProcedureFinancials(proc);
  const items = proc.items ?? [];
  const payments = [...(proc.payments ?? [])].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));

  return <div className="card" style={{ overflow: 'hidden', marginBottom: 8 }}>
    <button type="button" onClick={() => setOpen(value => !value)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ClipboardList size={18} style={{ color: 'var(--primary)' }} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem' }}>{format(parseISO(proc.performed_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}</div>
        <div className="page-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{procedureServiceNames(proc)}</div>
        {traceability.length > 0 && <span className="badge badge--rose" style={{ marginTop: 5 }}><ShieldCheck size={11} style={{ marginRight: 3 }} /> {traceability.length} rastreio{traceability.length === 1 ? '' : 's'}</span>}
        {finance.pendente > 0 && <span className="badge badge--amber" style={{ marginTop: 5, marginLeft: traceability.length > 0 ? 5 : 0 }}>Pendente {currency(finance.pendente)}</span>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}><strong style={{ color: 'var(--primary)' }}>{currency(finance.venda)}</strong><div className="page-sub">recebido {currency(finance.pago)}</div></div>
      <ChevronRight size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
    </button>

    {open && <div style={{ padding: '12px 16px 16px', borderTop: '1px solid var(--border)', display: 'grid', gap: 14 }}>
      <section>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Serviços realizados</strong>
        <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
          {items.length > 0 ? items.map(item => <div key={item.id} style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}><span style={{ fontSize: 13 }}>{item.qty > 1 ? `${item.qty}× ` : ''}{item.name}</span><strong style={{ fontSize: 13 }}>{currency(item.final_price * item.qty)}</strong></div>) : <span className="page-sub">Snapshots detalhados não disponíveis neste registro legado.</span>}
        </div>
      </section>

      <TraceabilitySection records={traceability} />

      <section>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Pagamentos</strong>
        <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
          {payments.length > 0 ? payments.map(payment => <div key={payment.id} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}><div><span style={{ fontSize: 13 }}>{paymentLabel(payment)}</span><div className="page-sub">{payment.paid_at ? `Recebido em ${new Date(payment.paid_at).toLocaleDateString('pt-BR')}` : payment.scheduled_date ? `Previsto para ${new Date(`${payment.scheduled_date}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Pendente'}</div></div><strong style={{ fontSize: 13 }}>{currency(payment.amount)}</strong></div>) : <span className="page-sub">Nenhum pagamento detalhado disponível.</span>}
        </div>
      </section>

      <section style={{ display: 'grid', gap: 5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="page-sub">Valor vendido</span><strong>{currency(finance.venda)}</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="page-sub">Recebido</span><strong>{currency(finance.pago)}</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="page-sub">Pendente</span><strong>{currency(finance.pendente)}</strong></div>
      </section>

      <section>
        <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Documentos</strong>
        <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
          {contracts.length > 0 ? contracts.map(contract => <div key={contract.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div><span style={{ fontSize: 13 }}>{contract.document_name_snapshot ?? contract.template?.name ?? 'Contrato'}</span><div className="page-sub">{CONTRACT_STATUS[contract.status]}</div></div>
            {contract.pdf_download_url && <a className="btn btn--ghost btn--sm" href={contract.pdf_download_url} target="_blank" rel="noopener noreferrer">Abrir PDF</a>}
          </div>) : <span className="page-sub">Nenhum documento vinculado a este atendimento.</span>}
        </div>
      </section>

      {proc.notes && <section><strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Observações</strong><p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{proc.notes}</p></section>}
      {proc.appointment_id && <div className="page-sub">Originado do agendamento {proc.appointment_id.slice(0, 8)}…</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onContract && <button className="btn btn--secondary btn--sm" onClick={() => onContract(proc.id)}><FileText size={14} /> Gerar documento</button>}
        {onPhotos && <button className="btn btn--ghost btn--sm" onClick={onPhotos}><Camera size={14} /> Fotos</button>}
        {onInjectables && <button className="btn btn--ghost btn--sm" onClick={onInjectables}><MapPin size={14} /> Injetáveis</button>}
      </div>
    </div>}
  </div>;
}

export function HistoricoTab({ patientId, onPhotos, onInjectables, onContract }: Props) {
  const { procedures, loading, error } = useProcedures(patientId);
  const { contracts, load: loadContracts } = useContracts(patientId);
  const { records: traceabilityRecords, byProcedure: traceabilityByProcedure, loading: loadingTraceability, error: traceabilityError } = useProcedureTraceability(patientId);
  const total = useMemo(() => procedures.reduce((sum, proc) => sum + getProcedureFinancials(proc).venda, 0), [procedures]);
  const contractsByProcedure = useMemo(() => {
    const map = new Map<string, Contract[]>();
    for (const contract of contracts) {
      if (!contract.procedure_id) continue;
      map.set(contract.procedure_id, [...(map.get(contract.procedure_id) ?? []), contract]);
    }
    return map;
  }, [contracts]);
  const procedureIds = useMemo(() => new Set(procedures.map(proc => proc.id)), [procedures]);
  const revertedGroups = useMemo(() => {
    const map = new Map<string, ProcedureTraceabilityWithEvidence[]>();
    for (const record of traceabilityRecords) {
      if (procedureIds.has(record.procedure_id_snapshot) || record.status === 'active') continue;
      map.set(record.procedure_id_snapshot, [...(map.get(record.procedure_id_snapshot) ?? []), record]);
    }
    return [...map.entries()];
  }, [procedureIds, traceabilityRecords]);

  useEffect(() => { void loadContracts(); }, [loadContracts]);

  if (error) return <div className="empty-state" style={{ padding: '48px 20px' }}><p>{error}</p></div>;
  if (loading || loadingTraceability) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} /></div>;
  if (procedures.length === 0 && revertedGroups.length === 0) return <div className="empty-state" style={{ padding: '48px 20px' }}><ClipboardList size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} /><p>Nenhum atendimento realizado.</p></div>;

  return <div style={{ padding: '0 0 16px' }}>
    {traceabilityError && <div style={{ padding: '9px 12px', background: '#fff7ed', border: '1px solid #fed7aa', color: '#b45309', borderRadius: 9, fontSize: 12, marginBottom: 10 }}>{traceabilityError}</div>}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border)' }}><span className="page-sub">{procedures.length} atendimento{procedures.length !== 1 ? 's' : ''}</span><strong style={{ color: 'var(--primary)' }}>Total: {currency(total)}</strong></div>
    {procedures.map(proc => <ProcedureCard key={proc.id} proc={proc} contracts={contractsByProcedure.get(proc.id) ?? []} traceability={traceabilityByProcedure.get(proc.id) ?? []} onPhotos={onPhotos} onInjectables={onInjectables} onContract={onContract} />)}
    {revertedGroups.length > 0 && <section style={{ marginTop: 18 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><ShieldCheck size={14} style={{ color: '#b45309' }} /><strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>Rastreabilidade de atendimentos revertidos</strong></div>{revertedGroups.map(([procedureId, records]) => <div key={procedureId} className="card" style={{ padding: 14, marginBottom: 8, borderColor: '#fed7aa' }}><div className="page-sub" style={{ marginBottom: 7 }}>{new Date(records[0].performed_at_snapshot).toLocaleString('pt-BR')} · procedimento {procedureId.slice(0, 8)}…</div><TraceabilitySection records={records} /></div>)}</section>}
  </div>;
}
