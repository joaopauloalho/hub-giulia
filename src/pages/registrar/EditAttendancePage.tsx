import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Boxes, Check, Clock3, CreditCard, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getFeePct, useMaquininhaConfig } from '../../hooks/useMaquininhaConfig';
import { useMaterials } from '../../hooks/useMaterials';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import { supabase } from '../../lib/supabase';
import type { CardBrand, SimplePaymentMethod } from '../../types';

const TODAY = new Date().toISOString().slice(0, 10);
const METHOD_LABELS: Record<SimplePaymentMethod, string> = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Crédito', cartao_debito: 'Débito' };
const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const qty = (value: number) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const isoDate = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : TODAY;

type EditItem = {
  id: string | null;
  serviceId: string;
  name: string;
  qty: number;
  listPrice: number;
  finalPrice: number;
  cost: number;
  coverageValue: number;
  covered: boolean;
  protected: boolean;
};

type EditMaterial = {
  materialId: string;
  quantity: number;
  originalQuantity: number;
  unitCostSnapshot: number | null;
  nameSnapshot: string;
  unitSnapshot: string;
};

type EditPayment = {
  key: string;
  method: SimplePaymentMethod;
  baseValue: number;
  cardBrand: CardBrand;
  installments: number;
  absorveTaxa: boolean;
  feePct: number;
  received: boolean;
  date: string;
  originalPaidAt: string | null;
};

type LoadedProcedure = {
  id: string;
  patient_id: string;
  performed_at: string;
  total_value: number;
  total_cost: number;
  notes: string | null;
  revision: number;
  clinical_minutes: number;
  clinical_hourly_rate_snapshot: number;
  attendance_type: 'procedure' | 'return';
  procedure_items: Array<{
    id: string; service_id: string; name: string; qty: number; list_price: number; final_price: number;
    cost_snapshot: number; coverage_value_snapshot: number; amount_due_snapshot: number;
  }>;
  procedure_payments: Array<{
    id: string; method: string; amount: number; card_brand: string | null; installments: number;
    fee_pct: number | null; fee_value: number | null; net_amount: number; absorve_taxa: boolean;
    scheduled_date: string | null; paid_at: string | null;
  }>;
  procedure_materials: Array<{
    material_id: string; material_name_snapshot: string; unit_label_snapshot: string; quantity: number;
    unit_cost_snapshot: number;
  }>;
};

function paymentAmounts(entry: EditPayment) {
  const feePct = Math.max(0, Number(entry.feePct || 0));
  if (!feePct) return { amount: entry.baseValue, feeValue: 0, netAmount: entry.baseValue };
  if (entry.absorveTaxa) {
    const feeValue = entry.baseValue * feePct / 100;
    return { amount: entry.baseValue, feeValue, netAmount: entry.baseValue - feeValue };
  }
  const netAmount = entry.baseValue;
  const amount = netAmount / (1 - feePct / 100);
  return { amount, feeValue: amount - netAmount, netAmount };
}

export function EditAttendancePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const procedureId = searchParams.get('edit') ?? '';
  const { toast, confirm } = useToast();
  const { servicos, loading: loadingServices } = useServicos();
  const { materials, loading: loadingMaterials } = useMaterials();
  const { config: machine, loading: loadingMachine } = useMaquininhaConfig();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [patientName, setPatientName] = useState('Paciente');
  const [procedure, setProcedure] = useState<LoadedProcedure | null>(null);
  const [performedDate, setPerformedDate] = useState(TODAY);
  const [notes, setNotes] = useState('');
  const [clinicalMinutes, setClinicalMinutes] = useState(0);
  const [items, setItems] = useState<EditItem[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<EditMaterial[]>([]);
  const [payments, setPayments] = useState<EditPayment[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [materialSearch, setMaterialSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!procedureId) { setLoadError('Atendimento inválido.'); setLoading(false); return; }
    let active = true;
    void (async () => {
      setLoading(true); setLoadError(null);
      try {
        const { data, error } = await supabase.from('procedures').select(`
          *,
          procedure_items:procedure_items!procedure_items_procedure_owner_fkey(*),
          procedure_payments:procedure_payments!procedure_payments_procedure_owner_fkey(*),
          procedure_materials:procedure_materials!procedure_materials_procedure_owner_fkey(*)
        `).eq('id', procedureId).single();
        if (error) throw error;
        const row = data as unknown as LoadedProcedure;
        const itemIds = row.procedure_items.map(item => item.id);
        const [redemptions, applications, returns, patient] = await Promise.all([
          supabase.from('package_redemptions').select('procedure_item_id_snapshot,coverage_value_snapshot').eq('procedure_id_snapshot', procedureId),
          itemIds.length ? supabase.from('injectable_applications').select('procedure_item_id').in('procedure_item_id', itemIds) : Promise.resolve({ data: [], error: null }),
          itemIds.length ? supabase.from('procedure_returns').select('procedure_item_id').in('procedure_item_id', itemIds) : Promise.resolve({ data: [], error: null }),
          supabase.from('patients').select('name').eq('id', row.patient_id).single(),
        ]);
        if (redemptions.error) throw redemptions.error;
        if (applications.error) throw applications.error;
        if (returns.error) throw returns.error;
        if (patient.error) throw patient.error;
        if (!active) return;

        const coverageByItem = new Map((redemptions.data ?? []).map(entry => [entry.procedure_item_id_snapshot, Number(entry.coverage_value_snapshot || 0)]));
        const protectedIds = new Set([
          ...(redemptions.data ?? []).map(entry => entry.procedure_item_id_snapshot),
          ...(applications.data ?? []).map(entry => entry.procedure_item_id),
          ...(returns.data ?? []).map(entry => entry.procedure_item_id).filter(Boolean),
        ]);
        setProcedure(row);
        setPatientName(String(patient.data.name));
        setPerformedDate(isoDate(row.performed_at));
        setNotes(row.notes ?? '');
        setClinicalMinutes(Number(row.clinical_minutes || 0));
        setItems(row.procedure_items.map(item => ({
          id: item.id,
          serviceId: item.service_id,
          name: item.name,
          qty: Number(item.qty),
          listPrice: Number(item.list_price),
          finalPrice: Number(item.final_price),
          cost: Number(item.cost_snapshot),
          coverageValue: coverageByItem.get(item.id) ?? Number(item.coverage_value_snapshot || 0),
          covered: coverageByItem.has(item.id),
          protected: protectedIds.has(item.id),
        })));
        setSelectedMaterials(row.procedure_materials.map(material => ({
          materialId: material.material_id,
          quantity: Number(material.quantity),
          originalQuantity: Number(material.quantity),
          unitCostSnapshot: Number(material.unit_cost_snapshot),
          nameSnapshot: material.material_name_snapshot,
          unitSnapshot: material.unit_label_snapshot,
        })));
        setPayments(row.procedure_payments.map(payment => ({
          key: payment.id,
          method: payment.method as SimplePaymentMethod,
          baseValue: Number(payment.absorve_taxa ? payment.amount : payment.net_amount),
          cardBrand: (payment.card_brand || 'master_visa') as CardBrand,
          installments: Number(payment.installments || 1),
          absorveTaxa: Boolean(payment.absorve_taxa),
          feePct: Number(payment.fee_pct || 0),
          received: Boolean(payment.paid_at),
          date: payment.scheduled_date ?? isoDate(payment.paid_at),
          originalPaidAt: payment.paid_at,
        })));
      } catch (error) {
        console.error('[attendance:edit-load]', error);
        if (active) setLoadError('Não foi possível carregar este atendimento para edição.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [procedureId]);

  const selectedServiceIds = useMemo(() => new Set(items.map(item => item.serviceId)), [items]);
  const selectedMaterialById = useMemo(() => new Map(selectedMaterials.map(item => [item.materialId, item])), [selectedMaterials]);
  const coverageTotal = items.reduce((sum, item) => sum + item.coverageValue, 0);
  const grossTotal = items.reduce((sum, item) => sum + item.finalPrice, 0);
  const amountDue = procedure?.attendance_type === 'return' ? 0 : Math.max(0, +(grossTotal - coverageTotal).toFixed(2));
  const allocated = payments.reduce((sum, payment) => sum + Number(payment.baseValue || 0), 0);
  const remaining = +(amountDue - allocated).toFixed(2);
  const itemsCost = items.reduce((sum, item) => sum + item.cost * item.qty, 0);
  const materialCost = selectedMaterials.reduce((sum, selected) => {
    const material = materials.find(row => row.id === selected.materialId);
    const unit = selected.unitCostSnapshot ?? material?.unit_cost ?? 0;
    return sum + selected.quantity * unit;
  }, 0);
  const clinicalCost = (clinicalMinutes / 60) * Number(procedure?.clinical_hourly_rate_snapshot || 0);
  const estimatedCost = itemsCost + materialCost + clinicalCost;
  const availableServices = servicos.filter(service => service.active && !selectedServiceIds.has(service.id) && service.name.toLowerCase().includes(serviceSearch.trim().toLowerCase()));
  const visibleMaterials = materials.filter(material => (material.active || selectedMaterialById.has(material.id)) && material.name.toLowerCase().includes(materialSearch.trim().toLowerCase()));
  const financialChanged = Boolean(procedure && Math.abs(amountDue - Number(procedure.total_value || 0)) > .01);

  useEffect(() => {
    if (!procedure || procedure.attendance_type === 'return') return;
    if (amountDue <= .009) { if (payments.length) setPayments([]); return; }
    if (!payments.length) {
      setPayments([{ key: crypto.randomUUID(), method: 'pix', baseValue: amountDue, cardBrand: 'master_visa', installments: 1, absorveTaxa: true, feePct: 0, received: true, date: TODAY, originalPaidAt: null }]);
    }
  }, [amountDue, payments.length, procedure]);

  const changePaymentPricing = (entry: EditPayment, patch: Partial<EditPayment>) => {
    const next = { ...entry, ...patch };
    const feePct = getFeePct(machine.rates, next.method, next.cardBrand, next.installments);
    return { ...next, feePct };
  };

  const setMaterialQuantity = (materialId: string, nextQuantity: number) => {
    const material = materials.find(row => row.id === materialId);
    const existing = selectedMaterialById.get(materialId);
    const rounded = Math.max(0, Math.round(nextQuantity * 1000) / 1000);
    if (rounded <= 0) { setSelectedMaterials(current => current.filter(row => row.materialId !== materialId)); return; }
    if (!material && !existing) return;
    setSelectedMaterials(current => {
      const next = current.filter(row => row.materialId !== materialId);
      next.push({
        materialId,
        quantity: rounded,
        originalQuantity: existing?.originalQuantity ?? 0,
        unitCostSnapshot: existing?.unitCostSnapshot ?? null,
        nameSnapshot: existing?.nameSnapshot ?? material!.name,
        unitSnapshot: existing?.unitSnapshot ?? material!.unit_label,
      });
      return next;
    });
  };

  const addService = (serviceId: string) => {
    const service = servicos.find(row => row.id === serviceId);
    if (!service || selectedServiceIds.has(service.id)) return;
    setItems(current => [...current, { id: null, serviceId: service.id, name: service.name, qty: 1, listPrice: service.price, finalPrice: procedure?.attendance_type === 'return' ? 0 : service.price, cost: Number(service.cost_per_unit || 0), coverageValue: 0, covered: false, protected: false }]);
    setServiceSearch('');
  };

  const updateItem = (serviceId: string, patch: Partial<EditItem>) => setItems(current => current.map(item => item.serviceId === serviceId ? { ...item, ...patch } : item));

  const save = async () => {
    if (!procedure || !items.length || saving) return;
    if (Math.abs(remaining) > .02) { toast.error(`A distribuição financeira precisa fechar em ${money(amountDue)}.`); return; }
    if (selectedMaterials.some(selected => {
      const material = materials.find(row => row.id === selected.materialId);
      const available = Number(material?.stock_quantity || 0) + selected.originalQuantity;
      return selected.quantity > available + .0005;
    })) { toast.error('A quantidade de um material ultrapassa o estoque disponível para a correção.'); return; }

    if (financialChanged) {
      const ok = await confirm({
        title: 'Alterar valor financeiro do atendimento?',
        message: `O valor do atendimento passará de ${money(procedure.total_value)} para ${money(amountDue)}. Os recebimentos abaixo serão atualizados no mesmo registro.`,
        confirmLabel: 'Salvar alteração',
        tone: 'danger',
      });
      if (!ok) return;
    }

    setSaving(true);
    try {
      const paymentPayload = amountDue <= .009 ? [] : payments.map(entry => {
        const amounts = paymentAmounts(entry);
        const samePaidDate = entry.originalPaidAt && isoDate(entry.originalPaidAt) === entry.date;
        const paidAt = entry.received ? (samePaidDate ? entry.originalPaidAt : `${entry.date || TODAY}T12:00:00-03:00`) : null;
        return {
          method: entry.method,
          base_amount: Number(entry.baseValue),
          amount: +amounts.amount.toFixed(2),
          card_brand: entry.method === 'cartao_credito' || entry.method === 'cartao_debito' ? entry.cardBrand : null,
          installments: entry.method === 'cartao_credito' ? entry.installments : 1,
          fee_pct: entry.feePct || null,
          fee_value: amounts.feeValue ? +amounts.feeValue.toFixed(2) : null,
          net_amount: +amounts.netAmount.toFixed(2),
          absorve_taxa: entry.absorveTaxa,
          scheduled_date: entry.date || null,
          paid_at: paidAt,
        };
      });
      const { error } = await supabase.rpc('update_procedure_v1', {
        p_procedure_id: procedure.id,
        p_expected_revision: procedure.revision,
        p_performed_at: new Date(`${performedDate}T12:00:00-03:00`).toISOString(),
        p_items: items.map(item => ({ service_id: item.serviceId, qty: item.qty, final_price: procedure.attendance_type === 'return' ? 0 : item.finalPrice, cost: item.cost })),
        p_payment_entries: paymentPayload,
        p_materials: selectedMaterials.map(material => ({ material_id: material.materialId, quantity: material.quantity })),
        p_clinical_minutes: clinicalMinutes,
        p_notes: notes,
        p_reason: 'Edição manual pela ficha da paciente',
      });
      if (error) throw error;
      toast.success('Atendimento atualizado. Estoque e custos foram recalculados.');
      navigate(`/pacientes/${procedure.patient_id}?tab=procedures`, { replace: true });
    } catch (error) {
      console.error('[attendance:edit-save]', error);
      const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
      if (message.includes('ATTENDANCE_EDIT_CONFLICT')) toast.error('Este atendimento foi alterado em outra tela. Reabra para carregar a versão mais recente.');
      else if (message.includes('MATERIAL_INSUFFICIENT_STOCK')) toast.error('Estoque insuficiente para um dos materiais selecionados.');
      else if (message.includes('ATTENDANCE_EDIT_PACKAGE_ITEM_LOCKED')) toast.error('Uma sessão de tratamento já consumida não pode ter serviço, quantidade ou valor comercial alterados. Os custos e materiais continuam editáveis.');
      else if (message.includes('ATTENDANCE_EDIT_ITEM_HAS_LINKED_HISTORY')) toast.error('Este item possui injetável, retorno ou crédito vinculado e não pode ser removido.');
      else if (message.includes('ATTENDANCE_PAYMENT_TOTAL_MISMATCH')) toast.error('A soma das formas de pagamento não corresponde ao novo valor do atendimento.');
      else toast.error('Não foi possível salvar a edição do atendimento.');
    } finally { setSaving(false); }
  };

  if (loading || loadingServices || loadingMaterials) return <div className="full-loader"><Loader2 className="spin" size={26}/> Carregando atendimento…</div>;
  if (loadError || !procedure) return <div className="empty-state"><AlertTriangle size={34}/><p>{loadError ?? 'Atendimento não encontrado.'}</p><button className="btn btn--secondary btn--md" onClick={() => navigate(-1)}>Voltar</button></div>;

  return <div className="page">
    <div className="page-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><button type="button" className="icon-btn" onClick={() => navigate(`/pacientes/${procedure.patient_id}?tab=procedures`)}><ArrowLeft size={20}/></button><div><h1 className="page-title">Editar atendimento</h1><p className="page-sub">{patientName} · mesmo registro · revisão {procedure.revision}</p></div></div>
      <button type="button" className="btn btn--primary btn--md" disabled={saving || Math.abs(remaining) > .02 || loadingMachine} onClick={() => void save()}>{saving ? <><Loader2 size={16} className="spin"/> Salvando…</> : <><Check size={16}/> Salvar alterações</>}</button>
    </div>

    <div style={{ padding: '0 16px 110px', display: 'grid', gap: 14, maxWidth: 1120, margin: '0 auto', width: '100%' }}>
      <div style={{ padding: 12, borderRadius: 10, border: '1px solid #fbcfe8', background: '#fdf2f8', color: '#9d174d', fontSize: 13 }}><strong>Você está editando o atendimento existente.</strong> Fotos, injetáveis, documentos e retornos continuam vinculados ao mesmo atendimento. O estoque é corrigido apenas pela diferença.</div>

      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Dados do atendimento</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,240px) 1fr', gap: 12 }}><div><label className="field-label">Data</label><input className="field-input" type="date" max={TODAY} value={performedDate} onChange={event => setPerformedDate(event.target.value)}/></div><div><label className="field-label">Observações</label><textarea className="field-input" rows={3} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Observações clínicas ou administrativas…"/></div></div>
      </section>

      <section className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>Procedimentos e produtos realizados</h2>
        <p className="page-sub" style={{ marginBottom: 12 }}>Corrija o que foi realizado e o custo real. Itens já ligados a injetáveis, retornos ou tratamentos permanecem protegidos para não quebrar o histórico.</p>
        <div style={{ display: 'grid', gap: 10 }}>{items.map(item => <div key={item.serviceId} style={{ border: '1px solid var(--border)', borderRadius: 11, padding: 12, background: 'var(--bg-2)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}><div><strong>{item.name}</strong><div style={{ display: 'flex', gap: 5, marginTop: 4 }}>{item.covered && <span className="badge badge--green">TRATAMENTO</span>}{item.protected && !item.covered && <span className="badge">VINCULADO</span>}</div></div><button type="button" className="icon-btn" disabled={item.protected} title={item.protected ? 'Item protegido por histórico vinculado' : 'Remover item'} onClick={() => setItems(current => current.filter(row => row.serviceId !== item.serviceId))}><Trash2 size={16}/></button></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(120px,1fr))', gap: 10, marginTop: 10 }}><div><label className="field-label">Quantidade</label><input className="field-input" type="number" inputMode="decimal" min="0.001" step="0.001" disabled={item.covered} value={item.qty} onChange={event => updateItem(item.serviceId, { qty: Math.max(.001, Number(event.target.value) || 1) })}/></div><div><label className="field-label">Valor cobrado</label><input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" disabled={item.covered || procedure.attendance_type === 'return'} value={procedure.attendance_type === 'return' ? 0 : item.finalPrice} onChange={event => updateItem(item.serviceId, { finalPrice: Math.max(0, Number(event.target.value) || 0) })}/></div><div><label className="field-label">Custo neste atendimento</label><input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" value={item.cost} onChange={event => updateItem(item.serviceId, { cost: Math.max(0, Number(event.target.value) || 0) })}/></div></div></div>)}</div>
        <div style={{ marginTop: 12 }}><label className="field-label">Adicionar procedimento/produto</label><div style={{ position: 'relative' }}><Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-3)' }}/><input className="field-input" style={{ paddingLeft: 36 }} value={serviceSearch} onChange={event => setServiceSearch(event.target.value)} placeholder="Buscar no catálogo…"/></div>{serviceSearch.trim() && <div style={{ marginTop: 6, display: 'grid', gap: 5, maxHeight: 190, overflowY: 'auto' }}>{availableServices.slice(0, 12).map(service => <button key={service.id} type="button" className="btn btn--ghost btn--sm" style={{ justifyContent: 'space-between' }} onClick={() => addService(service.id)}><span>{service.name}</span><Plus size={14}/></button>)}</div>}</div>
      </section>

      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Clock3 size={18} style={{ color: 'var(--primary)' }}/><h2 style={{ fontSize: '1rem' }}>Tempo clínico</h2></div>
        <p className="page-sub" style={{ margin: '4px 0 10px' }}>Mantemos o valor-hora congelado no atendimento ({money(procedure.clinical_hourly_rate_snapshot)}/h) e recalculamos somente pelo tempo corrigido.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,220px) 1fr', gap: 12, alignItems: 'end' }}><div><label className="field-label">Minutos</label><input className="field-input" type="number" inputMode="numeric" min="0" max="1440" step="5" value={clinicalMinutes} onChange={event => setClinicalMinutes(Math.max(0, Math.min(1440, Number(event.target.value) || 0)))}/></div><div style={{ padding: 11, borderRadius: 9, background: 'var(--bg-2)' }}>Custo do tempo: <strong>{money(clinicalCost)}</strong></div></div>
      </section>

      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Boxes size={18} style={{ color: 'var(--primary)' }}/><h2 style={{ fontSize: '1rem' }}>Materiais / insumos</h2></div>
        <p className="page-sub" style={{ margin: '4px 0 10px' }}>Altere livremente. Ao salvar, o Hub devolve o que saiu a mais e baixa somente o que faltou, sem criar outro atendimento.</p>
        <div style={{ position: 'relative', marginBottom: 10 }}><Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-3)' }}/><input className="field-input" style={{ paddingLeft: 36 }} value={materialSearch} onChange={event => setMaterialSearch(event.target.value)} placeholder="Buscar material…"/></div>
        <div style={{ display: 'grid', gap: 7, maxHeight: 420, overflowY: 'auto' }}>{visibleMaterials.map(material => { const selected = selectedMaterialById.get(material.id); const current = selected?.quantity ?? 0; const availableForCorrection = material.stock_quantity + (selected?.originalQuantity ?? 0); return <div key={material.id} style={{ display: 'grid', gridTemplateColumns: '1fr minmax(120px,170px)', gap: 12, alignItems: 'center', padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: current > 0 ? 'var(--bg-2)' : 'transparent' }}><div><strong style={{ fontSize: 13 }}>{material.name}</strong><div className="page-sub">Estoque agora: {qty(material.stock_quantity)} {material.unit_label} · disponível na correção até {qty(availableForCorrection)}</div></div><div><label className="field-label">Quantidade usada</label><input className="field-input" inputMode="decimal" value={current || ''} placeholder="0" onChange={event => setMaterialQuantity(material.id, Number(event.target.value.replace(',','.')) || 0)}/></div></div>; })}</div>
      </section>

      {procedure.attendance_type !== 'return' && <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CreditCard size={18} style={{ color: 'var(--primary)' }}/><h2 style={{ fontSize: '1rem' }}>Financeiro do mesmo atendimento</h2></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, margin: '8px 0 12px', padding: 10, borderRadius: 9, background: 'var(--bg-2)' }}><span>Valor após as correções</span><strong>{money(amountDue)}</strong></div>
        {amountDue > .009 && <><div style={{ display: 'grid', gap: 9 }}>{payments.map(entry => { const amounts = paymentAmounts(entry); return <div key={entry.key} style={{ padding: 11, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-2)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}><strong>Forma de pagamento</strong>{payments.length > 1 && <button type="button" className="icon-btn" onClick={() => setPayments(current => current.filter(row => row.key !== entry.key))}><Trash2 size={15}/></button>}</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 9 }}><div><label className="field-label">Forma</label><select className="field-input" value={entry.method} onChange={event => setPayments(current => current.map(row => row.key === entry.key ? changePaymentPricing(row, { method: event.target.value as SimplePaymentMethod, installments: 1 }) : row))}>{Object.entries(METHOD_LABELS).map(([method,label]) => <option value={method} key={method}>{label}</option>)}</select></div><div><label className="field-label">Valor alocado</label><input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" value={entry.baseValue} onChange={event => setPayments(current => current.map(row => row.key === entry.key ? { ...row, baseValue: Math.max(0, Number(event.target.value) || 0) } : row))}/></div>{(entry.method === 'cartao_credito' || entry.method === 'cartao_debito') && <div><label className="field-label">Bandeira</label><select className="field-input" value={entry.cardBrand} onChange={event => setPayments(current => current.map(row => row.key === entry.key ? changePaymentPricing(row, { cardBrand: event.target.value as CardBrand }) : row))}><option value="master_visa">Master / Visa</option><option value="elo">Elo</option></select></div>}{entry.method === 'cartao_credito' && <div><label className="field-label">Parcelas</label><select className="field-input" value={entry.installments} onChange={event => setPayments(current => current.map(row => row.key === entry.key ? changePaymentPricing(row, { installments: Number(event.target.value) }) : row))}>{Array.from({ length: 18 }, (_, index) => index + 1).map(value => <option value={value} key={value}>{value}x</option>)}</select></div>}<div><label className="field-label">Situação</label><select className="field-input" value={entry.received ? 'paid' : 'pending'} onChange={event => setPayments(current => current.map(row => row.key === entry.key ? { ...row, received: event.target.value === 'paid' } : row))}><option value="paid">Recebido</option><option value="pending">A receber</option></select></div><div><label className="field-label">Data</label><input className="field-input" type="date" value={entry.date} onChange={event => setPayments(current => current.map(row => row.key === entry.key ? { ...row, date: event.target.value } : row))}/></div></div>{entry.feePct > 0 && <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><button type="button" className={`btn btn--sm ${entry.absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setPayments(current => current.map(row => row.key === entry.key ? { ...row, absorveTaxa: true } : row))}>Clínica absorve</button><button type="button" className={`btn btn--sm ${!entry.absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setPayments(current => current.map(row => row.key === entry.key ? { ...row, absorveTaxa: false } : row))}>Repassar taxa</button><span className="page-sub">taxa {entry.feePct.toFixed(2)}% · paciente {money(amounts.amount)} · líquido {money(amounts.netAmount)}</span></div>}</div>; })}</div><button type="button" className="btn btn--secondary btn--sm" style={{ marginTop: 9 }} onClick={() => setPayments(current => [...current, { key: crypto.randomUUID(), method: 'pix', baseValue: Math.max(0, remaining), cardBrand: 'master_visa', installments: 1, absorveTaxa: true, feePct: 0, received: true, date: TODAY, originalPaidAt: null }])}><Plus size={14}/> Outra forma</button><div style={{ marginTop: 9, textAlign: 'center', padding: 9, borderRadius: 9, background: Math.abs(remaining) <= .02 ? '#f0fdf4' : '#fffbeb', color: Math.abs(remaining) <= .02 ? '#166534' : '#b45309', fontWeight: 700 }}>{Math.abs(remaining) <= .02 ? '✓ Financeiro confere' : remaining > 0 ? `Falta alocar ${money(remaining)}` : `Excede ${money(Math.abs(remaining))}`}</div></>}
      </section>}

      <section className="card" style={{ position: 'sticky', bottom: 12, zIndex: 4, boxShadow: '0 8px 28px rgba(0,0,0,.08)' }}><div style={{ display: 'grid', gap: 6 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Procedimentos/produtos</span><strong>{money(itemsCost)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Materiais</span><strong>{money(materialCost)}</strong></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Tempo clínico</span><strong>{money(clinicalCost)}</strong></div><div style={{ borderTop: '1px solid var(--border)', paddingTop: 7, display: 'flex', justifyContent: 'space-between', fontSize: 16 }}><strong>Custo total corrigido</strong><strong style={{ color: 'var(--primary)' }}>{money(estimatedCost)}</strong></div></div><button type="button" className="btn btn--primary btn--md" style={{ width: '100%', marginTop: 10 }} disabled={saving || Math.abs(remaining) > .02 || loadingMachine} onClick={() => void save()}>{saving ? <><Loader2 size={16} className="spin"/> Salvando…</> : <><Check size={16}/> Salvar no mesmo atendimento</>}</button></section>
    </div>
  </div>;
}
