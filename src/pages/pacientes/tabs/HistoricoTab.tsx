import { useMemo, useState } from 'react';
import { ChevronRight, ClipboardList, Loader2, Trash2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useProcedures } from '../../../hooks/useProcedures';
import { useServicos } from '../../../hooks/useServicos';
import { useToast } from '../../../hooks/useToast';
import type { Procedure, Service } from '../../../types';

interface Props { patientId: string; }

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

function serviceNames(proc: Procedure, services: Service[]) {
  const names = proc.services_ids
    .map(id => services.find(service => service.id === id)?.name)
    .filter(Boolean);

  return names.length > 0 ? names.join(', ') : 'Serviços registrados';
}

function RetornoChip({ proc, services }: { proc: Procedure; services: Service[] }) {
  const procServices = proc.services_ids
    .map(id => services.find(s => s.id === id))
    .filter((s): s is Service => s !== undefined);

  const minValues = procServices
    .map(s => s.return_min_days)
    .filter((d): d is number => d !== null);
  const maxValues = procServices
    .map(s => s.return_max_days)
    .filter((d): d is number => d !== null);

  if (minValues.length === 0 || maxValues.length === 0) return null;

  return (
    <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', marginTop: 2, display: 'inline-block' }}>
      ↩ {Math.min(...minValues)}–{Math.max(...maxValues)}d
    </span>
  );
}

function ProcedureCard({ proc, services, onRemove }: { proc: Procedure; services: Service[]; onRemove: (proc: Procedure) => void }) {
  const [open, setOpen] = useState(false);
  const lucro = proc.net_value - proc.total_cost;

  const details = [
    { label: 'Cobrado', value: currency(proc.total_value) },
    ...(proc.card_fee_value ? [{ label: 'Taxa maquininha', value: `-${currency(proc.card_fee_value)}` }] : []),
    { label: 'Custo', value: `-${currency(proc.total_cost)}` },
    { label: 'Lucro', value: currency(lucro) },
  ];

  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      marginBottom: 8,
    }}>
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
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          flexShrink: 0,
          background: 'var(--bg-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <ClipboardList size={18} style={{ color: 'var(--primary)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.9rem' }}>
            {format(parseISO(proc.performed_at), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}
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
          <RetornoChip proc={proc} services={services} />
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 2 }}>
            {PAYMENT_LABELS[proc.payment_method]}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '0.95rem' }}>
            {currency(proc.total_value)}
          </div>
          <div style={{ fontSize: '0.72rem', color: lucro >= 0 ? 'var(--green)' : 'var(--red)' }}>
            lucro {currency(lucro)}
          </div>
        </div>
        <ChevronRight
          size={16}
          style={{
            color: 'var(--text-3)',
            flexShrink: 0,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.2s',
          }}
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
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => onRemove(proc)}
            style={{ marginTop: 12 }}
          >
            <Trash2 size={14} /> Excluir atendimento
          </button>
        </div>
      )}
    </div>
  );
}

export function HistoricoTab({ patientId }: Props) {
  const { procedures, loading, error, remove } = useProcedures(patientId);
  const { servicos, loading: loadingServices, error: servicesError } = useServicos();
  const { confirm, toast } = useToast();

  const total = useMemo(
    () => procedures.reduce((sum, proc) => sum + proc.total_value, 0),
    [procedures]
  );

  const handleRemove = async (proc: Procedure) => {
    const ok = await confirm({
      title: 'Excluir atendimento',
      message: 'Excluir este atendimento? Os pagamentos e parcelas vinculados tambem serao removidos do financeiro. Fotos e mapas ficam preservados, apenas desvinculados.',
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await remove(proc.id);
      toast.success('Atendimento excluido.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao excluir atendimento.');
    }
  };

  if (error || servicesError) {
    return (
      <div className="empty-state" style={{ padding: '48px 20px' }}>
        <p>{error ?? servicesError}</p>
      </div>
    );
  }

  if (loading || loadingServices) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  if (procedures.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '48px 20px' }}>
        <ClipboardList size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
        <p>Nenhum atendimento registrado ainda.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 0 16px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
        padding: '10px 14px',
        background: 'var(--bg-2)',
        borderRadius: 10,
        border: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>
          {procedures.length} atendimento{procedures.length !== 1 ? 's' : ''}
        </span>
        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
          Total: {currency(total)}
        </span>
      </div>

      {procedures.map(proc => (
        <ProcedureCard key={proc.id} proc={proc} services={servicos} onRemove={handleRemove} />
      ))}
    </div>
  );
}
