import { useEffect, useMemo, useState } from 'react';
import { Camera, ChevronRight, ClipboardList, FileText, Loader2, MapPin } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useProcedures } from '../../../hooks/useProcedures';
import { useContracts } from '../../../hooks/useContracts';
import { getProcedureFinancials, procedureServiceNames } from '../../../lib/financeIntegrity';
import type { Contract, Procedure, ProcedurePayment } from '../../../types';

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

function ProcedureCard({ proc, contracts, onPhotos, onInjectables, onContract }: { proc: Procedure; contracts: Contract[]; onPhotos?: () => void; onInjectables?: () => void; onContract?: (procedureId: string) => void }) {
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
        {finance.pendente > 0 && <span className="badge badge--amber" style={{ marginTop: 5 }}>Pendente {currency(finance.pendente)}</span>}
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
  const total = useMemo(() => procedures.reduce((sum, proc) => sum + getProcedureFinancials(proc).venda, 0), [procedures]);
  const contractsByProcedure = useMemo(() => {
    const map = new Map<string, Contract[]>();
    for (const contract of contracts) {
      if (!contract.procedure_id) continue;
      map.set(contract.procedure_id, [...(map.get(contract.procedure_id) ?? []), contract]);
    }
    return map;
  }, [contracts]);

  useEffect(() => { void loadContracts(); }, [loadContracts]);

  if (error) return <div className="empty-state" style={{ padding: '48px 20px' }}><p>{error}</p></div>;
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} /></div>;
  if (procedures.length === 0) return <div className="empty-state" style={{ padding: '48px 20px' }}><ClipboardList size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} /><p>Nenhum atendimento realizado.</p></div>;

  return <div style={{ padding: '0 0 16px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, padding: '10px 14px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border)' }}><span className="page-sub">{procedures.length} atendimento{procedures.length !== 1 ? 's' : ''}</span><strong style={{ color: 'var(--primary)' }}>Total: {currency(total)}</strong></div>
    {procedures.map(proc => <ProcedureCard key={proc.id} proc={proc} contracts={contractsByProcedure.get(proc.id) ?? []} onPhotos={onPhotos} onInjectables={onInjectables} onContract={onContract} />)}
  </div>;
}
