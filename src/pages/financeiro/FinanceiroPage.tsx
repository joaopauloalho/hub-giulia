import { useState } from 'react';
import { addMonths, format, isPast, isToday, parseISO, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useFinanceiro } from '../../hooks/useFinanceiro';
import { useServicos } from '../../hooks/useServicos';
import type { PixInstallment, Procedure, Service } from '../../types';

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão Crédito',
  cartao_debito: 'Cartão Débito',
  pix: 'PIX',
  pix_parcelado: 'PIX Parcelado',
};

function currency(value: number) {
  return `R$ ${value.toFixed(2)}`;
}

function patientName(proc: Procedure) {
  return proc.patient?.name ?? 'Paciente';
}

function serviceNames(proc: Procedure, services: Service[]) {
  const names = proc.services_ids
    .map(id => services.find(service => service.id === id)?.name)
    .filter(Boolean);

  return names.length > 0 ? names.join(', ') : 'Serviços registrados';
}

function SummaryCards({
  receitaTotal,
  recebido,
  pendente,
  custos,
  lucro,
}: {
  receitaTotal: number;
  recebido: number;
  pendente: number;
  custos: number;
  lucro: number;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 10, marginBottom: 28 }}>
      <div style={{ padding: '14px 10px', background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
        <Wallet size={18} style={{ color: 'var(--primary)', marginBottom: 6 }} />
        <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>Receita total</div>
        <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.95rem' }}>{currency(receitaTotal)}</div>
      </div>
      <div style={{ padding: '14px 10px', background: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0', textAlign: 'center' }}>
        <CheckCircle size={18} style={{ color: 'var(--green)', marginBottom: 6 }} />
        <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>Recebido</div>
        <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: '0.95rem' }}>{currency(recebido)}</div>
      </div>
      <div style={{ padding: '14px 10px', background: '#fffbf0', borderRadius: 12, border: '1px solid #fde68a', textAlign: 'center' }}>
        <Clock size={18} style={{ color: 'var(--amber)', marginBottom: 6 }} />
        <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>Pendente</div>
        <div style={{ fontWeight: 700, color: 'var(--amber)', fontSize: '0.95rem' }}>{currency(pendente)}</div>
      </div>
      <div style={{ padding: '14px 10px', background: 'var(--bg-2)', borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
        <TrendingDown size={18} style={{ color: 'var(--red)', marginBottom: 6 }} />
        <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>Custos</div>
        <div style={{ fontWeight: 700, color: 'var(--red)', fontSize: '0.95rem' }}>{currency(custos)}</div>
      </div>
      <div style={{
        padding: '14px 10px',
        background: lucro >= 0 ? '#f0fdf4' : '#fef2f2',
        borderRadius: 12,
        border: `1px solid ${lucro >= 0 ? '#bbf7d0' : '#fecaca'}`,
        textAlign: 'center',
      }}>
        <TrendingUp size={18} style={{ color: lucro >= 0 ? 'var(--green)' : 'var(--red)', marginBottom: 6 }} />
        <div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 4 }}>Lucro</div>
        <div style={{ fontWeight: 700, color: lucro >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.95rem' }}>{currency(lucro)}</div>
      </div>
    </div>
  );
}

function PixPendentes({ items, onPagar }: { items: PixInstallment[]; onPagar: (id: string) => Promise<void> }) {
  const [paying, setPaying] = useState<string | null>(null);

  const handlePagar = async (id: string) => {
    setPaying(id);
    try {
      await onPagar(id);
    } finally {
      setPaying(null);
    }
  };

  if (items.length === 0) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>
        Nenhum PIX pendente.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map(inst => {
        const due = parseISO(inst.due_date);
        const overdue = (isPast(due) && !isToday(due)) || isToday(due);
        const dueColor = overdue ? 'var(--red)' : 'var(--amber)';
        const name = inst.procedure?.patient?.name ?? 'Paciente';

        return (
          <div
            key={inst.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 16px',
              background: overdue ? '#fff5f5' : '#fffbf0',
              border: `1px solid ${overdue ? '#fecaca' : '#fde68a'}`,
              borderLeft: `4px solid ${dueColor}`,
              borderRadius: 'var(--radius)',
            }}
          >
            <Clock size={18} style={{ color: dueColor, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: 600,
                color: 'var(--text)',
                fontSize: '0.9rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {name}
              </div>
              <div style={{ fontSize: '0.75rem', color: dueColor, fontWeight: 500 }}>
                Parcela {inst.installment_num}/{inst.total_installments} - vence {format(due, 'dd/MM/yyyy')}
                {overdue && ' - VENCIDA'}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)' }}>{currency(inst.amount)}</div>
              <button
                onClick={() => handlePagar(inst.id)}
                disabled={paying === inst.id}
                style={{
                  marginTop: 4,
                  padding: '4px 10px',
                  background: 'var(--green)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: paying === inst.id ? 0.6 : 1,
                }}
              >
                {paying === inst.id
                  ? <Loader2 size={12} className="spin" />
                  : <CheckCircle size={12} />}
                Recebido
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProcedureRow({ proc, services }: { proc: Procedure; services: Service[] }) {
  const [open, setOpen] = useState(false);
  const lucro = proc.net_value - proc.total_cost;
  const details = [
    { label: 'Receita', value: currency(proc.total_value) },
    ...(proc.card_fee_value ? [{ label: 'Taxa maquininha', value: `-${currency(proc.card_fee_value)}` }] : []),
    { label: 'Custo', value: `-${currency(proc.total_cost)}` },
    { label: 'Lucro', value: currency(lucro) },
  ];

  return (
    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 8 }}>
      <button
        onClick={() => setOpen(value => !value)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem' }}>
            {patientName(proc)}
          </div>
          <div style={{
            fontSize: '0.75rem',
            color: 'var(--text-3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {serviceNames(proc, services)}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 2 }}>
            {format(parseISO(proc.performed_at), 'dd/MM/yyyy HH:mm')} - {PAYMENT_LABELS[proc.payment_method]}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{currency(proc.total_value)}</div>
          <div style={{ fontSize: '0.72rem', color: lucro >= 0 ? 'var(--green)' : 'var(--red)' }}>
            lucro {currency(lucro)}
          </div>
        </div>
        <ChevronRight
          size={16}
          style={{ color: 'var(--text-3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
        />
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
        </div>
      )}
    </div>
  );
}

export function FinanceiroPage() {
  const [month, setMonth] = useState(new Date());
  const { procedures, pixPendentes, summary, loading, error, markPixPago } = useFinanceiro(month);
  const { servicos, loading: loadingServices, error: servicesError } = useServicos();
  const monthLabel = format(month, 'MMMM yyyy', { locale: ptBR });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financeiro</h1>
        </div>
      </div>

      <div style={{ padding: '0 16px 100px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
          padding: '10px 16px',
          background: 'var(--bg-2)',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
        }}>
          <button
            onClick={() => setMonth(value => subMonths(value, 1))}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 6, color: 'var(--primary)' }}
            aria-label="Mês anterior"
          >
            <ChevronLeft size={20} />
          </button>
          <span style={{ fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize' }}>
            {monthLabel}
          </span>
          <button
            onClick={() => setMonth(value => addMonths(value, 1))}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 6, color: 'var(--primary)' }}
            aria-label="Próximo mês"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {error || servicesError ? (
          <div className="empty-state">
            <p>{error ?? servicesError}</p>
          </div>
        ) : loading || loadingServices ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Loader2 size={28} className="spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : (
          <>
            <SummaryCards
              receitaTotal={summary.receitaTotal}
              recebido={summary.recebido}
              pendente={summary.pendente}
              custos={summary.custos}
              lucro={summary.lucro}
            />

            <section style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                PIX Parcelados Pendentes
                {pixPendentes.length > 0 && (
                  <span style={{
                    padding: '2px 8px',
                    background: 'var(--red)',
                    color: 'white',
                    borderRadius: 10,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                  }}>{pixPendentes.length}</span>
                )}
              </h2>
              <PixPendentes items={pixPendentes} onPagar={markPixPago} />
            </section>

            <section>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>
                Histórico - {procedures.length} atendimento{procedures.length !== 1 ? 's' : ''}
              </h2>
              {procedures.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem', padding: '24px 0' }}>
                  Nenhum atendimento neste mês.
                </div>
              ) : (
                procedures.map(proc => <ProcedureRow key={proc.id} proc={proc} services={servicos} />)
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
