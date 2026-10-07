import { useMemo, useState } from 'react';
import { Clock3, Loader2, Search, WalletCards } from 'lucide-react';
import { ReceivablePaymentModal } from '../../components/ReceivablePaymentModal';
import { useReceivables, type OpenReceivable } from '../../hooks/useReceivables';

const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function ReceivablesPage() {
  const { items, loading, error, registerReceipt } = useReceivables();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<OpenReceivable | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return items;
    return items.filter(item => `${item.patient_name} ${item.service_names}`.toLocaleLowerCase('pt-BR').includes(normalized));
  }, [items, query]);

  const totalPending = useMemo(() => items.reduce((sum, item) => sum + item.pending_amount, 0), [items]);
  const patientCount = useMemo(() => new Set(items.map(item => item.patient_id)).size, [items]);

  return <div className="page">
    <div className="page-header">
      <div>
        <h1 className="page-title">A receber</h1>
        <p className="page-sub">Veja quem ainda tem saldo e registre qualquer valor recebido sem precisar abrir a ficha da paciente.</p>
      </div>
    </div>

    <div style={{ padding: '0 16px 100px', display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
        <div className="card" style={{ padding: 14 }}>
          <div className="page-sub">Total em aberto</div>
          <strong style={{ display: 'block', fontSize: '1.15rem', color: '#92400e' }}>{money(totalPending)}</strong>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="page-sub">Pacientes com saldo</div>
          <strong style={{ display: 'block', fontSize: '1.15rem' }}>{patientCount}</strong>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="page-sub">Cobranças abertas</div>
          <strong style={{ display: 'block', fontSize: '1.15rem' }}>{items.length}</strong>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={17} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }}/>
        <input className="field-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por paciente ou procedimento…" style={{ paddingLeft: 38 }}/>
      </div>

      {error ? <div className="empty-state"><p>{error}</p></div> : loading ? <div style={{ display: 'grid', placeItems: 'center', padding: 44 }}><Loader2 size={24} className="spin"/></div> : filtered.length === 0 ? (
        <div className="empty-state" style={{ padding: 34 }}>
          <WalletCards size={24}/>
          <p>{items.length === 0 ? 'Nenhum valor em aberto.' : 'Nenhum resultado para essa busca.'}</p>
        </div>
      ) : <div style={{ display: 'grid', gap: 9 }}>
        {filtered.map(item => <article key={item.procedure_id} className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 260px' }}>
              <strong style={{ display: 'block', fontSize: '.95rem' }}>{item.patient_name}</strong>
              <div className="page-sub" style={{ marginTop: 2 }}>{item.service_names}</div>
              <div className="page-sub" style={{ marginTop: 4 }}>{new Date(item.performed_at).toLocaleDateString('pt-BR')}</div>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, color: item.next_due_date ? '#92400e' : 'var(--text-3)', fontSize: '.76rem' }}>
                <Clock3 size={13}/>
                {item.next_due_date ? `Previsão ${new Date(`${item.next_due_date}T12:00:00`).toLocaleDateString('pt-BR')}` : 'Sem data definida'}
              </div>
            </div>

            <div style={{ minWidth: 200, flex: '0 1 270px', display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="page-sub">Valor</span><strong>{money(item.total_value)}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span className="page-sub">Já recebido</span><strong style={{ color: '#166534' }}>{money(item.received_amount)}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingTop: 6, borderTop: '1px solid var(--border)' }}><span style={{ color: '#92400e', fontWeight: 700 }}>Falta receber</span><strong style={{ color: '#92400e' }}>{money(item.pending_amount)}</strong></div>
              <button type="button" className="btn btn--primary btn--sm" style={{ marginTop: 4, justifyContent: 'center' }} onClick={() => setSelected(item)}>+ Registrar recebimento</button>
            </div>
          </div>
        </article>)}
      </div>}
    </div>

    {selected && <ReceivablePaymentModal
      receivable={selected}
      onClose={() => setSelected(null)}
      onSubmit={registerReceipt}
    />}
  </div>;
}
