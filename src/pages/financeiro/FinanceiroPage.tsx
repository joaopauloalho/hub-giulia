import { useMemo, useState } from 'react';
import { addMonths, format, isPast, isToday, parseISO, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Loader2,
  ReceiptText,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { useFinanceiro } from '../../hooks/useFinanceiro';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import { Skeleton } from '../../components/ui/Skeleton';
import { FinanceiroReportPDF } from '../../components/FinanceiroReportPDF';
import {
  getProcedureFinancials,
  procedurePaymentLabel,
  procedureServiceNames,
  summarizeFinance,
  type FinanceiroSummary,
} from '../../lib/financeIntegrity';
import type { PixInstallment, Procedure, ProcedurePayment, Service } from '../../types';

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão Crédito',
  cartao_debito: 'Cartão Débito',
  pix: 'PIX',
  pix_parcelado: 'PIX Parcelado',
  split: 'Pagamento dividido',
};

function currency(value: number) {
  return `R$ ${value.toFixed(2)}`;
}

function SummaryCards({ summary }: { summary: FinanceiroSummary }) {
  const cards = [
    { label: 'Vendas', value: summary.vendas, icon: ReceiptText, color: 'var(--primary)', bg: 'var(--bg-2)', border: 'var(--border)' },
    { label: 'Pago', value: summary.pago, icon: CheckCircle, color: 'var(--green)', bg: '#f0fdf4', border: '#bbf7d0' },
    { label: 'Taxas pagas', value: summary.taxas, icon: TrendingDown, color: 'var(--red)', bg: '#fef2f2', border: '#fecaca' },
    { label: 'Líquido pago', value: summary.liquido, icon: Wallet, color: 'var(--primary)', bg: 'var(--bg-2)', border: 'var(--border)' },
    { label: 'Pendente', value: summary.pendente, icon: Clock, color: 'var(--amber)', bg: '#fffbf0', border: '#fde68a' },
    { label: 'Custos', value: summary.custos, icon: TrendingDown, color: 'var(--red)', bg: 'var(--bg-2)', border: 'var(--border)' },
    { label: 'Líquido pago após custos', value: summary.lucro, icon: TrendingUp, color: summary.lucro >= 0 ? 'var(--green)' : 'var(--red)', bg: summary.lucro >= 0 ? '#f0fdf4' : '#fef2f2', border: summary.lucro >= 0 ? '#bbf7d0' : '#fecaca' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 10, marginBottom: 28 }}>
      {cards.map(({ label, value, icon: Icon, color, bg, border }) => (
        <div key={label} style={{ padding: '14px 10px', background: bg, borderRadius: 12, border: `1px solid ${border}`, textAlign: 'center' }}>
          <Icon size={18} style={{ color, marginBottom: 6 }} />
          <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
          <div style={{ fontWeight: 700, color, fontSize: '0.95rem' }}>{currency(value)}</div>
        </div>
      ))}
    </div>
  );
}

function PixPendentes({ items, onPagar }: { items: PixInstallment[]; onPagar: (id: string) => Promise<void> }) {
  const [paying, setPaying] = useState<string | null>(null);

  if (items.length === 0) return null;

  const handlePagar = async (id: string) => {
    setPaying(id);
    try { await onPagar(id); } finally { setPaying(null); }
  };

  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        PIX Parcelados Pendentes
        <span style={{ padding: '2px 8px', background: 'var(--red)', color: 'white', borderRadius: 10, fontSize: '0.72rem', fontWeight: 700 }}>
          {items.length}
        </span>
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(inst => {
          const due = parseISO(inst.due_date);
          const overdue = (isPast(due) && !isToday(due)) || isToday(due);
          const dueColor = overdue ? 'var(--red)' : 'var(--amber)';
          const name = inst.procedure?.patient?.name ?? 'Paciente';
          return (
            <div key={inst.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: overdue ? '#fff5f5' : '#fffbf0', border: `1px solid ${overdue ? '#fecaca' : '#fde68a'}`, borderLeft: `4px solid ${dueColor}`, borderRadius: 'var(--radius)' }}>
              <Clock size={18} style={{ color: dueColor, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                <div style={{ fontSize: '0.75rem', color: dueColor, fontWeight: 500 }}>
                  Parcela {inst.installment_num}/{inst.total_installments} - vence {format(due, 'dd/MM/yyyy')}{overdue && ' - VENCIDA'}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--text)' }}>{currency(inst.amount)}</div>
                <button onClick={() => handlePagar(inst.id)} disabled={paying === inst.id} style={{ marginTop: 4, padding: '4px 10px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: paying === inst.id ? 0.6 : 1 }}>
                  {paying === inst.id ? <Loader2 size={12} className="spin" /> : <CheckCircle size={12} />}
                  Recebido
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PagamentosPendentes({ items, onPagar }: { items: ProcedurePayment[]; onPagar: (id: string) => Promise<void> }) {
  const [paying, setPaying] = useState<string | null>(null);

  if (items.length === 0) return null;

  const handlePagar = async (id: string) => {
    setPaying(id);
    try { await onPagar(id); } finally { setPaying(null); }
  };

  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        Pagamentos Agendados
        <span style={{ padding: '2px 8px', background: 'var(--red)', color: 'white', borderRadius: 10, fontSize: '0.72rem', fontWeight: 700 }}>
          {items.length}
        </span>
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map(payment => {
          const due = payment.scheduled_date ? parseISO(payment.scheduled_date) : null;
          const overdue = due ? (isPast(due) || isToday(due)) : false;
          const dueColor = overdue ? 'var(--red)' : 'var(--amber)';
          const name = payment.procedure?.patient?.name ?? 'Paciente';
          const methodLabel = PAYMENT_LABELS[payment.method] ?? payment.method;
          const installLabel = payment.installments > 1 ? ` ${payment.installments}x` : '';
          return (
            <div key={payment.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: overdue ? '#fff5f5' : '#fffbf0', border: `1px solid ${overdue ? '#fecaca' : '#fde68a'}`, borderLeft: `4px solid ${dueColor}`, borderRadius: 'var(--radius)' }}>
              <Clock size={18} style={{ color: dueColor, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                <div style={{ fontSize: '0.75rem', color: dueColor, fontWeight: 500 }}>
                  {methodLabel}{installLabel}{due ? ` - ${format(due, 'dd/MM/yyyy')}` : ''}{overdue && ' - VENCIDO'}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--text)' }}>{currency(payment.amount)}</div>
                <button onClick={() => handlePagar(payment.id)} disabled={paying === payment.id} style={{ marginTop: 4, padding: '4px 10px', background: 'var(--green)', color: 'white', border: 'none', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, opacity: paying === payment.id ? 0.6 : 1 }}>
                  {paying === payment.id ? <Loader2 size={12} className="spin" /> : <CheckCircle size={12} />}
                  Recebido
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProcedureRow({ proc, services, onRemove }: { proc: Procedure; services: Service[]; onRemove: (proc: Procedure) => void }) {
  const [open, setOpen] = useState(false);
  const values = getProcedureFinancials(proc);
  const details = [
    { label: 'Venda', value: currency(values.venda) },
    { label: 'Pago', value: currency(values.pago) },
    { label: 'Taxas pagas', value: `-${currency(values.taxas)}` },
    { label: 'Líquido pago', value: currency(values.liquido) },
    ...(values.pendente > 0 ? [{ label: 'Pendente', value: currency(values.pendente) }] : []),
    { label: 'Custo', value: `-${currency(values.custo)}` },
    { label: 'Líquido pago após custos', value: currency(values.lucro) },
  ];

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 8 }}>
      <button onClick={() => setOpen(value => !value)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem' }}>{proc.patient?.name ?? 'Paciente'}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {procedureServiceNames(proc, services)}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 2 }}>
            {format(parseISO(proc.performed_at), 'dd/MM/yyyy HH:mm')} - {procedurePaymentLabel(proc, PAYMENT_LABELS)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{currency(values.venda)}</div>
          <div style={{ fontSize: '0.72rem', color: values.lucro >= 0 ? 'var(--green)' : 'var(--red)' }}>
            líquido {currency(values.liquido)}
          </div>
        </div>
        <ChevronRight size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 10 }}>
            {details.map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>{row.label}</span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text)' }}>{row.value}</span>
              </div>
            ))}
          </div>
          <button type="button" className="btn btn--danger btn--sm" onClick={() => onRemove(proc)} style={{ marginTop: 12 }}>
            <Trash2 size={14} /> Excluir atendimento
          </button>
        </div>
      )}
    </div>
  );
}

export function FinanceiroPage() {
  const [month, setMonth] = useState(new Date());
  const { procedures, pixPendentes, pagamentosPendentes, loading, error, markPixPago, markPagamentoPago, removeProcedure } = useFinanceiro(month);
  const { servicos, loading: loadingServices } = useServicos();
  const { toast, confirm } = useToast();
  const monthLabel = format(month, 'MMMM yyyy', { locale: ptBR });
  const summary = useMemo(() => summarizeFinance(procedures), [procedures]);

  const exportPdf = async () => {
    try {
      const blob = await pdf(<FinanceiroReportPDF month={month} summary={summary} procedures={procedures} services={servicos} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `financeiro-${format(month, 'yyyy-MM')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('PDF gerado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar PDF.');
    }
  };

  const handleRemoveProcedure = async (proc: Procedure) => {
    const ok = await confirm({
      title: 'Excluir atendimento',
      message: 'Excluir este atendimento? O financeiro vinculado, incluindo pagamentos e parcelas, sera removido junto.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await removeProcedure(proc.id);
      toast.success('Atendimento e financeiro excluidos.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir atendimento.');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Financeiro</h1></div>
        <button className="btn btn--secondary btn--sm" onClick={exportPdf} disabled={loading || procedures.length === 0}>
          <Download size={16} /> Exportar PDF
        </button>
      </div>

      <div style={{ padding: '0 16px 100px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, padding: '10px 16px', background: 'var(--bg-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <button onClick={() => setMonth(value => subMonths(value, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 6, color: 'var(--primary)' }} aria-label="Mês anterior">
            <ChevronLeft size={20} />
          </button>
          <span style={{ fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize' }}>{monthLabel}</span>
          <button onClick={() => setMonth(value => addMonths(value, 1))} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 6, color: 'var(--primary)' }} aria-label="Próximo mês">
            <ChevronRight size={20} />
          </button>
        </div>

        {error ? (
          <div className="empty-state"><p>{error}</p></div>
        ) : loading ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 10, marginBottom: 28 }}>
              {Array.from({ length: 7 }, (_, index) => <div className="card" key={index}><Skeleton height={54} /></div>)}
            </div>
            <div style={{ textAlign: 'center', padding: 16 }}><Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} /></div>
          </div>
        ) : (
          <>
            <SummaryCards summary={summary} />
            <PixPendentes items={pixPendentes} onPagar={markPixPago} />
            <PagamentosPendentes items={pagamentosPendentes} onPagar={markPagamentoPago} />

            <section>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
                Histórico - {procedures.length} atendimento{procedures.length !== 1 ? 's' : ''}
              </h2>
              {procedures.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem', padding: '24px 0' }}>Nenhum atendimento neste mês.</div>
              ) : (
                procedures.map(proc => <ProcedureRow key={proc.id} proc={proc} services={servicos} onRemove={handleRemoveProcedure} />)
              )}
              {loadingServices && <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 8 }}>Carregando catálogo para compatibilidade com históricos antigos…</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
