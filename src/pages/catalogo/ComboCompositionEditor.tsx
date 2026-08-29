import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import type { Service } from '../../types';
import { fetchComboComposition, replaceComboComposition, type ComboCompositionDraftItem } from '../../hooks/useComboComposition';

export function ComboCompositionEditor({ combo, services }: { combo: Service; services: Service[] }) {
  const [items, setItems] = useState<ComboCompositionDraftItem[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const serviceById = useMemo(() => new Map(services.map(service => [service.id, service])), [services]);
  const candidates = useMemo(() => services.filter(service => service.active && service.type === 'servico' && !items.some(item => item.component_service_id === service.id)), [items, services]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchComboComposition(combo.id).then(rows => {
      if (!alive) return;
      setItems(rows.map(row => ({ component_service_id: row.component_service_id, quantity: row.quantity })));
      setError('');
    }).catch(err => { if (alive) setError(err instanceof Error ? err.message : 'Não foi possível carregar a composição.'); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [combo.id]);

  const add = () => {
    if (!serviceId || quantity <= 0) return;
    setItems(current => [...current, { component_service_id: serviceId, quantity }]);
    setServiceId('');
    setQuantity(1);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await replaceComboComposition(combo.id, items);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a composição.');
    } finally { setSaving(false); }
  };

  return <section style={{ marginTop: 15, padding: 14, border: '1px solid #ddd6fe', background: '#faf5ff', borderRadius: 12 }}>
    <div style={{ marginBottom: 10 }}><strong style={{ display: 'block', fontSize: '.88rem', color: '#6d28d9' }}>Composição do tratamento</strong><p style={{ margin: '4px 0 0', fontSize: '.74rem', lineHeight: 1.45, color: 'var(--text-2)' }}>Defina quais procedimentos e quantas sessões este combo entrega. Na venda, o valor é pago uma vez; nos atendimentos seguintes o Hub baixa cada sessão sem cobrar novamente.</p></div>
    {loading ? <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: 10, fontSize: '.78rem', color: 'var(--text-3)' }}><Loader2 size={15} className="spin"/> Carregando composição…</div> : <>
      {items.length === 0 ? <div style={{ padding: 10, borderRadius: 9, background: '#fff7ed', border: '1px solid #fed7aa', color: '#b45309', fontSize: '.73rem', marginBottom: 10 }}><strong>Combo ainda não estruturado.</strong><br/>Enquanto estiver assim, ele continuará funcionando como um item único por compatibilidade.</div> : <div style={{ display: 'grid', gap: 7, marginBottom: 10 }}>{items.map((item, index) => { const service = serviceById.get(item.component_service_id); return <div key={item.component_service_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px auto', gap: 7, alignItems: 'center', padding: 9, border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-1)' }}><span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: '.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{service?.name ?? 'Serviço indisponível'}</strong><small className="page-sub">{item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} sessão{item.quantity === 1 ? '' : 'ões'}</small></span><input className="field-input" type="number" min="0.001" step="1" value={item.quantity} onChange={event => { const next = Number(event.target.value); setItems(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: next } : row)); setSaved(false); }} aria-label={`Quantidade de ${service?.name ?? 'sessões'}`} style={{ minHeight: 36, padding: '6px 8px' }}/><button type="button" className="icon-btn" onClick={() => { setItems(current => current.filter((_, rowIndex) => rowIndex !== index)); setSaved(false); }} aria-label="Remover da composição"><Trash2 size={15}/></button></div>; })}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px auto', gap: 7 }}><select className="field-input" value={serviceId} onChange={event => setServiceId(event.target.value)}><option value="">Adicionar procedimento…</option>{candidates.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select><input className="field-input" type="number" min="1" step="1" value={quantity} onChange={event => setQuantity(Math.max(1, Number(event.target.value) || 1))} aria-label="Quantidade de sessões"/><button type="button" className="btn btn--secondary btn--sm" onClick={add} disabled={!serviceId}><Plus size={14}/> Adicionar</button></div>
      <button type="button" className="btn btn--secondary btn--md" onClick={() => void save()} disabled={saving || items.some(item => !item.component_service_id || item.quantity <= 0)} style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}>{saving ? <Loader2 size={15} className="spin"/> : saved ? <Check size={15}/> : null}{saving ? 'Salvando…' : saved ? 'Composição salva' : 'Salvar composição'}</button>
    </>}
    {error && <p style={{ margin: '8px 0 0', color: 'var(--red)', fontSize: '.72rem' }}>{error}</p>}
  </section>;
}
