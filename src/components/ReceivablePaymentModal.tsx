import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import { getFeePct, useMaquininhaConfig } from '../hooks/useMaquininhaConfig';
import { useToast } from '../hooks/useToast';
import { supabase } from '../lib/supabase';
import type { CardBrand, SimplePaymentMethod } from '../types';
import type { OpenReceivable, RegisterReceiptInput } from '../hooks/useReceivables';

const TODAY = format(new Date(), 'yyyy-MM-dd');
const METHOD_LABELS: Record<SimplePaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_credito: 'Crédito',
  cartao_debito: 'Débito',
};
const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type PaymentHistoryRow = {
  id: string;
  method: string;
  amount: number;
  paid_at: string;
  scheduled_date: string | null;
};

interface Props {
  receivable: OpenReceivable;
  onClose: () => void;
  onSubmit: (input: RegisterReceiptInput) => Promise<void>;
}

export function ReceivablePaymentModal({ receivable, onClose, onSubmit }: Props) {
  const { config } = useMaquininhaConfig();
  const { toast } = useToast();
  const [amount, setAmount] = useState(receivable.pending_amount);
  const [method, setMethod] = useState<SimplePaymentMethod>('pix');
  const [paidOn, setPaidOn] = useState(TODAY);
  const [cardBrand, setCardBrand] = useState<CardBrand>('master_visa');
  const [installments, setInstallments] = useState(1);
  const [absorveTaxa, setAbsorveTaxa] = useState(true);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<PaymentHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const card = method === 'cartao_credito' || method === 'cartao_debito';
  const feePct = card ? getFeePct(config.rates, method, cardBrand, installments) : 0;
  const remaining = Math.max(0, +(receivable.pending_amount - amount).toFixed(2));
  const valid = amount > .009 && amount <= receivable.pending_amount + .01 && Boolean(paidOn) && paidOn <= TODAY;

  const amounts = useMemo(() => {
    if (!card || feePct <= 0) return { clientPays: amount, feeValue: 0, netAmount: amount };
    if (absorveTaxa) {
      const feeValue = amount * feePct / 100;
      return { clientPays: amount, feeValue, netAmount: amount - feeValue };
    }
    const clientPays = amount / (1 - feePct / 100);
    return { clientPays, feeValue: clientPays - amount, netAmount: amount };
  }, [absorveTaxa, amount, card, feePct]);

  useEffect(() => {
    let alive = true;
    setHistoryLoading(true);
    void supabase
      .from('procedure_payments')
      .select('id,method,amount,paid_at,scheduled_date')
      .eq('procedure_id', receivable.procedure_id)
      .not('paid_at', 'is', null)
      .order('paid_at', { ascending: false })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          console.error('[receivables:history]', error);
          setHistory([]);
        } else {
          setHistory((data ?? []).map(row => ({
            id: String(row.id),
            method: String(row.method),
            amount: Number(row.amount ?? 0),
            paid_at: String(row.paid_at),
            scheduled_date: row.scheduled_date ? String(row.scheduled_date) : null,
          })));
        }
        setHistoryLoading(false);
      });
    return () => { alive = false; };
  }, [receivable.procedure_id]);

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSubmit({
        procedureId: receivable.procedure_id,
        amount,
        method,
        paidOn,
        cardBrand: card ? cardBrand : null,
        installments: method === 'cartao_credito' ? installments : 1,
        absorveTaxa,
        feePct,
      });
      toast.success(remaining > .009 ? `Recebimento registrado. Ainda faltam ${money(remaining)}.` : 'Recebimento registrado. Cobrança quitada.');
      onClose();
    } catch (err) {
      console.error('[receivables:receipt]', err);
      const raw = err instanceof Error ? err.message : String(err);
      if (raw.includes('RECEIPT_EXCEEDS_PENDING')) toast.error('O valor informado é maior que o saldo em aberto.');
      else if (raw.includes('RECEIPT_NOTHING_PENDING')) toast.error('Esse atendimento já está quitado.');
      else toast.error('Não foi possível registrar o recebimento.');
    } finally {
      setSaving(false);
    }
  };

  return <div
    role="presentation"
    onClick={onClose}
    style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.38)', display: 'grid', placeItems: 'center', padding: 16 }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receivable-payment-title"
      onClick={event => event.stopPropagation()}
      style={{ width: 'min(620px,100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 24px 60px rgba(15,23,42,.18)' }}
    >
      <div style={{ position: 'sticky', top: 0, zIndex: 2, padding: '15px 16px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 id="receivable-payment-title" style={{ fontSize: '1.05rem', margin: 0 }}>Registrar recebimento</h2>
          <div className="page-sub">{receivable.patient_name} · {receivable.service_names}</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={18}/></button>
      </div>

      <div style={{ padding: 16, display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 }}>
          <div style={{ padding: 12, borderRadius: 11, background: 'var(--bg-2)', border: '1px solid var(--border)' }}><small className="page-sub">Valor do atendimento</small><strong style={{ display: 'block' }}>{money(receivable.total_value)}</strong></div>
          <div style={{ padding: 12, borderRadius: 11, background: '#f0fdf4', border: '1px solid #bbf7d0' }}><small style={{ color: '#166534' }}>Já recebido</small><strong style={{ display: 'block', color: '#166534' }}>{money(receivable.received_amount)}</strong></div>
          <div style={{ padding: 12, borderRadius: 11, background: '#fffbeb', border: '1px solid #fde68a' }}><small style={{ color: '#92400e' }}>Saldo em aberto</small><strong style={{ display: 'block', color: '#92400e' }}>{money(receivable.pending_amount)}</strong></div>
        </div>

        <div>
          <label className="field-label" htmlFor="receivable-amount">Quanto entrou agora?</label>
          <input id="receivable-amount" className="field-input" type="number" inputMode="decimal" min="0.01" step="0.01" max={receivable.pending_amount} value={amount || ''} onFocus={event => event.currentTarget.select()} onChange={event => setAmount(Math.max(0, Number(event.target.value) || 0))}/>
          <small className="page-sub">{remaining > .009 ? `Depois deste recebimento ainda ficará ${money(remaining)} em aberto.` : 'Este recebimento quita o saldo.'}</small>
        </div>

        <div>
          <label className="field-label">Forma de pagamento</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }}>
            {(Object.entries(METHOD_LABELS) as [SimplePaymentMethod, string][]).map(([value, label]) => <button key={value} type="button" className={`btn btn--sm ${method === value ? 'btn--primary' : 'btn--ghost'}`} style={{ minHeight: 42 }} onClick={() => { setMethod(value); setInstallments(1); }}>{label}</button>)}
          </div>
        </div>

        {card && <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label className="field-label">Bandeira</label>
            <div style={{ display: 'flex', gap: 7 }}>
              {(['master_visa', 'elo'] as CardBrand[]).map(brand => <button key={brand} type="button" className={`btn btn--sm ${cardBrand === brand ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setCardBrand(brand)}>{brand === 'master_visa' ? 'Master / Visa' : 'Elo'}</button>)}
            </div>
          </div>
          {method === 'cartao_credito' && <div>
            <label className="field-label" htmlFor="receivable-installments">Parcelas</label>
            <select id="receivable-installments" className="field-input" value={installments} onChange={event => setInstallments(Number(event.target.value))}>
              {Array.from({ length: 18 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value}x</option>)}
            </select>
          </div>}
          {feePct > 0 && <div style={{ padding: 11, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)' }}>
            <div style={{ display: 'flex', gap: 7, marginBottom: 6 }}>
              <button type="button" className={`btn btn--sm ${absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAbsorveTaxa(true)}>Clínica absorve</button>
              <button type="button" className={`btn btn--sm ${!absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setAbsorveTaxa(false)}>Repassar taxa</button>
            </div>
            <small className="page-sub">Cliente paga {money(amounts.clientPays)} · taxa {money(amounts.feeValue)} · líquido {money(amounts.netAmount)}</small>
          </div>}
        </div>}

        <div>
          <label className="field-label" htmlFor="receivable-date">Data do recebimento</label>
          <input id="receivable-date" className="field-input" type="date" max={TODAY} value={paidOn} onChange={event => setPaidOn(event.target.value)}/>
        </div>

        <button type="button" className="btn-primary" style={{ width: '100%', minHeight: 50, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, opacity: valid ? 1 : .5 }} disabled={!valid || saving} onClick={() => void submit()}>
          {saving ? <Loader2 size={18} className="spin"/> : <Check size={18}/>} {saving ? 'Registrando…' : 'Registrar recebimento'}
        </button>

        <section style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>Histórico deste atendimento</strong>
          {historyLoading ? <div className="page-sub">Carregando recebimentos…</div> : history.length === 0 ? <div className="page-sub">Nenhum recebimento registrado ainda.</div> : <div style={{ display: 'grid', gap: 6 }}>
            {history.map(row => <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <span className="page-sub">{new Date(row.paid_at).toLocaleDateString('pt-BR')} · {METHOD_LABELS[row.method as SimplePaymentMethod] ?? row.method}</span>
              <strong>{money(row.amount)}</strong>
            </div>)}
          </div>}
        </section>
      </div>
    </div>
  </div>;
}
