import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import { CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Gift, Loader2, Plus, Save, Tag, Trash2, X } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { useProcedures } from '../../hooks/useProcedures';
import { useInjetaveis } from '../../hooks/useInjetaveis';
import { getFeePct, useMaquininhaConfig } from '../../hooks/useMaquininhaConfig';
import { usePatientEntitlements } from '../../hooks/usePackages';
import { useToast } from '../../hooks/useToast';
import { useAttendanceDraft, type AttendanceDraftPayload } from '../../hooks/useAttendanceDraft';
import { clearAttendanceInjectableDraft, clearAttendanceInjectablePoints } from '../../lib/attendanceRuntime';
import { treatmentSessionLabel } from '../../lib/treatmentExecution';
import type { CardBrand, InjectablePoint, MaquininhaRates, Patient, PaymentEntryUI, PaymentMethod, Service, SimplePaymentMethod } from '../../types';
import type { PatientEntitlement } from '../../types/packages';
import { MaterialsStep, type SelectedAttendanceMaterial } from './MaterialsStep';
import { TreatmentExecutionStep } from './TreatmentExecutionStep';

const InjetaveisScreen = lazy(() => import('./InjetaveisScreen').then(module => ({ default: module.InjetaveisScreen })));
const TODAY = format(new Date(), 'yyyy-MM-dd');
const TOMORROW = format(addDays(new Date(), 1), 'yyyy-MM-dd');
type PaymentTiming = 'today' | 'later';
const METHOD_LABELS: Record<SimplePaymentMethod, string> = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Crédito', cartao_debito: 'Débito' };
const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function newPayment(amount: number, timing: PaymentTiming): PaymentEntryUI {
  return { tempId: crypto.randomUUID(), method: 'pix', baseValue: amount, cardBrand: 'master_visa', installments: 1, absorveTaxa: true, scheduledDate: timing === 'today' ? TODAY : '' };
}

function paymentAmounts(entry: PaymentEntryUI, rates: MaquininhaRates) {
  const feePct = getFeePct(rates, entry.method, entry.cardBrand, entry.installments);
  if (!feePct) return { feePct: 0, clientPays: entry.baseValue, feeValue: 0, netAmount: entry.baseValue };
  if (entry.absorveTaxa) {
    const feeValue = entry.baseValue * feePct / 100;
    return { feePct, clientPays: entry.baseValue, feeValue, netAmount: entry.baseValue - feeValue };
  }
  const netAmount = entry.baseValue;
  const clientPays = netAmount / (1 - feePct / 100);
  return { feePct, clientPays, feeValue: clientPays - netAmount, netAmount };
}

function StepBar({ step, hasInjectables, hasPayment }: { step: number; hasInjectables: boolean; hasPayment: boolean }) {
  const labels = ['Paciente', 'Atendimento', ...(hasInjectables ? ['Injetáveis'] : []), 'Materiais', ...(hasPayment ? ['Financeiro'] : []), 'Confirmar'];
  const active = step === 0 ? 0 : step === 1 ? 1 : step === 2 ? 2 + (hasInjectables ? 1 : 0) : step === 3 ? 3 + (hasInjectables ? 1 : 0) : labels.length - 1;
  return <div aria-label="Etapas do atendimento" style={{ display: 'flex', gap: 4, marginBottom: 22 }}>{labels.map((label, index) => <div key={label} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}><div style={{ height: 4, borderRadius: 999, background: index <= active ? 'var(--primary)' : 'var(--border)' }}/><span style={{ display: 'block', marginTop: 4, fontSize: '.61rem', whiteSpace: 'nowrap', color: index === active ? 'var(--primary)' : 'var(--text-3)', fontWeight: index === active ? 700 : 400 }}>{label}</span></div>)}</div>;
}

function PatientStep({ onSelect }: { onSelect: (patient: Patient) => void }) {
  const [query, setQuery] = useState('');
  const { pacientes, loading, nextPage, hasMore } = usePacientes({ search: query });
  return <div><h2 style={{ fontSize: '1.1rem', marginBottom: 5 }}>Selecione a paciente</h2><p className="page-sub" style={{ marginBottom: 14 }}>Você também pode iniciar direto pela aba Atendimentos da paciente.</p><input className="field-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone…" autoFocus style={{ marginBottom: 14 }}/>{loading ? <div style={{ padding: 34, textAlign: 'center' }}><Loader2 className="spin" size={24}/></div> : <div style={{ display: 'grid', gap: 8 }}>{pacientes.map(patient => <button key={patient.id} type="button" onClick={() => onSelect(patient)} style={{ minHeight: 58, width: '100%', padding: '14px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-2)', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}><span><strong style={{ display: 'block' }}>{patient.name}</strong>{patient.phone && <small className="page-sub">{patient.phone}</small>}</span><ChevronRight size={18}/></button>)}{pacientes.length === 0 && <div className="empty-state">Nenhuma paciente encontrada.</div>}{hasMore && <button type="button" className="btn btn--secondary btn--md" onClick={nextPage}>Carregar mais</button>}</div>}</div>;
}

function ServiceAdjustments({ services, coverage, prices, courtesy, setPrice, setCourtesy }: { services: Service[]; coverage: Record<string, string | undefined>; prices: Record<string, number>; courtesy: Record<string, boolean>; setPrice: (id: string, value: number) => void; setCourtesy: (service: Service, value: boolean) => void }) {
  const extras = services.filter(service => !coverage[service.id]);
  if (!extras.length) return null;
  return <section style={{ marginTop: 18 }}><div style={{ marginBottom: 10 }}><strong style={{ display: 'block' }}>Valor realizado</strong><span className="page-sub">O valor do catálogo vem preenchido. Ajuste descontos ou marque a cortesia.</span></div><div style={{ display: 'grid', gap: 9 }}>{extras.map(service => {
    const isGift = Boolean(courtesy[service.id]);
    const finalValue = isGift ? 0 : Number(prices[service.id] ?? service.price);
    const discount = Math.max(0, service.price - finalValue);
    const pct = service.price > 0 ? discount / service.price * 100 : 0;
    return <div key={service.id} style={{ padding: 13, border: `1px solid ${isGift ? '#fbcfe8' : 'var(--border)'}`, borderRadius: 12, background: isGift ? '#fdf2f8' : 'var(--bg-2)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><strong>{service.name}</strong><small className="page-sub" style={{ display: 'block' }}>Catálogo: {money(service.price)}</small></div>{isGift && <span className="badge" style={{ background: '#fce7f3', color: '#9d174d', fontWeight: 800 }}><Gift size={12}/> BRINDE</span>}</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, alignItems: 'end', marginTop: 10 }}><div><label className="field-label">Valor cobrado</label><input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" disabled={isGift} value={finalValue} onChange={event => setPrice(service.id, Math.max(0, Number(event.target.value) || 0))}/>{!isGift && discount > .009 && <small style={{ color: '#166534', fontWeight: 700 }}><Tag size={11}/> desconto {money(discount)} · {pct.toFixed(0)}%</small>}</div><button type="button" className={`btn btn--md ${isGift ? 'btn--primary' : 'btn--ghost'}`} style={{ minHeight: 44 }} onClick={() => setCourtesy(service, !isGift)}><Gift size={16}/> {isGift ? 'Remover brinde' : 'Marcar como brinde'}</button></div></div>;
  })}</div></section>;
}

function PaymentCard({ entry, timing, rates, canRemove, onChange, onRemove }: { entry: PaymentEntryUI; timing: PaymentTiming; rates: MaquininhaRates; canRemove: boolean; onChange: (entry: PaymentEntryUI) => void; onRemove: () => void }) {
  const amounts = paymentAmounts(entry, rates);
  const card = entry.method === 'cartao_credito' || entry.method === 'cartao_debito';
  return <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-2)', display: 'grid', gap: 11 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>{timing === 'later' ? 'Recebimento combinado' : 'Pagamento'}</strong>{canRemove && <button type="button" className="icon-btn" onClick={onRemove} aria-label="Remover forma"><Trash2 size={15}/></button>}</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }}>{(Object.entries(METHOD_LABELS) as [SimplePaymentMethod, string][]).map(([method, label]) => <button key={method} type="button" className={`btn btn--sm ${entry.method === method ? 'btn--primary' : 'btn--ghost'}`} style={{ minHeight: 42 }} onClick={() => onChange({ ...entry, method, installments: 1 })}>{label}</button>)}</div><div><label className="field-label">Valor nesta forma de pagamento</label><input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" value={entry.baseValue || ''} onChange={event => onChange({ ...entry, baseValue: Number(event.target.value) || 0 })}/><small className="page-sub">Este campo só divide o total entre as formas de pagamento; não altera o desconto do procedimento.</small></div>{card && <div><label className="field-label">Bandeira</label><div style={{ display: 'flex', gap: 7 }}>{(['master_visa', 'elo'] as CardBrand[]).map(brand => <button key={brand} type="button" className={`btn btn--sm ${entry.cardBrand === brand ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, cardBrand: brand })}>{brand === 'master_visa' ? 'Master / Visa' : 'Elo'}</button>)}</div></div>}{entry.method === 'cartao_credito' && <div><label className="field-label">Parcelas</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{Array.from({ length: 18 }, (_, index) => index + 1).map(value => <button key={value} type="button" className={`btn btn--sm ${entry.installments === value ? 'btn--primary' : 'btn--ghost'}`} style={{ minWidth: 42 }} onClick={() => onChange({ ...entry, installments: value })}>{value}x</button>)}</div></div>}{amounts.feePct > 0 && <div><label className="field-label">Taxa</label><div style={{ display: 'flex', gap: 7 }}><button type="button" className={`btn btn--sm ${entry.absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, absorveTaxa: true })}>Clínica absorve</button><button type="button" className={`btn btn--sm ${!entry.absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, absorveTaxa: false })}>Repassar</button></div><small className="page-sub">Cliente paga {money(amounts.clientPays)} · taxa {money(amounts.feeValue)} · líquido {money(amounts.netAmount)}</small></div>}{timing === 'later' && <div><label className="field-label">Previsão de recebimento</label><input className="field-input" type="date" min={TOMORROW} value={entry.scheduledDate} onChange={event => onChange({ ...entry, scheduledDate: event.target.value })}/><small className="page-sub">Ficará em A receber até o pagamento ser confirmado.</small></div>}</div>;
}

function FinancialStep({ amount, entries, setEntries, rates, timing, setTiming, onEditAmount }: { amount: number; entries: PaymentEntryUI[]; setEntries: (entries: PaymentEntryUI[]) => void; rates: MaquininhaRates; timing: PaymentTiming; setTiming: (value: PaymentTiming) => void; onEditAmount: () => void }) {
  const allocated = entries.reduce((sum, entry) => sum + entry.baseValue, 0);
  const remaining = +(amount - allocated).toFixed(2);
  const choose = (next: PaymentTiming) => { setTiming(next); setEntries(entries.length ? entries.map(entry => ({ ...entry, scheduledDate: next === 'today' ? TODAY : '' })) : [newPayment(amount, next)]); };
  return <div><h2 style={{ fontSize: '1.15rem', marginBottom: 5 }}>Situação financeira</h2><p className="page-sub" style={{ marginBottom: 14 }}>Atendimento e recebimento são eventos diferentes. Registre o que realmente aconteceu.</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 9, marginBottom: 16 }}><button type="button" aria-pressed={timing === 'today'} onClick={() => choose('today')} style={{ minHeight: 84, padding: 13, borderRadius: 13, border: `2px solid ${timing === 'today' ? 'var(--primary)' : 'var(--border)'}`, background: timing === 'today' ? 'var(--bg-2)' : 'var(--bg)', color: 'inherit', textAlign: 'left' }}><CheckCircle2 size={20} style={{ color: 'var(--primary)' }}/><strong style={{ display: 'block' }}>Pago hoje</strong><small className="page-sub">Registra o recebimento agora.</small></button><button type="button" aria-pressed={timing === 'later'} onClick={() => choose('later')} style={{ minHeight: 84, padding: 13, borderRadius: 13, border: `2px solid ${timing === 'later' ? '#d97706' : 'var(--border)'}`, background: timing === 'later' ? '#fffbeb' : 'var(--bg)', color: 'inherit', textAlign: 'left' }}><Clock3 size={20} style={{ color: '#b45309' }}/><strong style={{ display: 'block' }}>Receber depois</strong><small className="page-sub">Cria um valor em A receber.</small></button></div><div style={{ padding: 12, marginBottom: 8, borderRadius: 10, background: timing === 'later' ? '#fffbeb' : '#fdf2f8', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><span>{timing === 'later' ? 'Total a receber após descontos' : 'Total do atendimento após descontos'}</span><strong>{money(amount)}</strong></div><div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><small className="page-sub">Para dar desconto, altere o <strong>Valor cobrado</strong> do procedimento. Abaixo você apenas divide como esse total será pago.</small><button type="button" className="btn btn--ghost btn--sm" onClick={onEditAmount}><Tag size={14}/> Alterar valor / desconto</button></div><div style={{ display: 'grid', gap: 10 }}>{entries.map(entry => <PaymentCard key={entry.tempId} entry={entry} timing={timing} rates={rates} canRemove={entries.length > 1} onChange={updated => setEntries(entries.map(item => item.tempId === entry.tempId ? updated : item))} onRemove={() => setEntries(entries.filter(item => item.tempId !== entry.tempId))}/>)}</div><button type="button" className="btn btn--secondary btn--md" style={{ marginTop: 10 }} onClick={() => setEntries([...entries, newPayment(Math.max(0, remaining), timing)])}><Plus size={15}/> Adicionar outra forma</button><div style={{ marginTop: 10, padding: 10, textAlign: 'center', borderRadius: 9, background: Math.abs(remaining) < .01 ? '#f0fdf4' : '#fffbeb', color: Math.abs(remaining) < .01 ? '#166534' : '#b45309', fontWeight: 700 }}>{Math.abs(remaining) < .01 ? '✓ Valor alocado' : remaining > 0 ? `Falta ${money(remaining)}` : `Excede ${money(Math.abs(remaining))}`}</div>{Math.abs(remaining) >= .01 && <small className="page-sub" style={{ display: 'block', textAlign: 'center', marginTop: 5 }}>Se essa diferença for desconto, use “Alterar valor / desconto” acima em vez de diminuir o valor da forma de pagamento.</small>}</div>;
}

export function TreatmentRegistrarPageV2() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { create } = useProcedures();
  const { pacientes, loading: loadingPatients, getById } = usePacientes();
  const { servicos, loading: loadingServices } = useServicos();
  const { config: machine, loading: loadingMachine, error: machineError } = useMaquininhaConfig();
  const { save: saveInjectables } = useInjetaveis();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [materials, setMaterials] = useState<SelectedAttendanceMaterial[]>([]);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<Record<string, string | undefined>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [courtesy, setCourtesy] = useState<Record<string, boolean>>({});
  const [performedDate, setPerformedDate] = useState(TODAY);
  const [notes, setNotes] = useState('');
  const [timing, setTiming] = useState<PaymentTiming>('today');
  const [payments, setPayments] = useState<PaymentEntryUI[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [injectablePoints, setInjectablePoints] = useState<InjectablePoint[]>([]);
  const [injectablesOpen, setInjectablesOpen] = useState(false);
  const [injectablesDone, setInjectablesDone] = useState(false);
  const restoredRef = useRef<string | null>(null);
  const { data: entitlements, loading: loadingEntitlements } = usePatientEntitlements(patient?.id);
  const draft = useAttendanceDraft(patient?.id);
  const hasInjectables = services.some(service => service.is_injectable);
  const amountDue = useMemo(() => Math.max(0, +services.reduce((sum, service) => coverage[service.id] || courtesy[service.id] ? sum : sum + Number(prices[service.id] ?? service.price), 0).toFixed(2)), [coverage, courtesy, prices, services]);
  const hasPayment = amountDue > .01;
  const routeState = (location.state ?? {}) as { patient?: Patient; patientId?: string; appointmentId?: string; serviceId?: string | null };

  useEffect(() => {
    const requested = routeState.patient;
    const patientId = searchParams.get('patient_id') ?? searchParams.get('patientId') ?? routeState.patientId ?? requested?.id;
    const nextAppointment = searchParams.get('appointment_id') ?? routeState.appointmentId ?? null;
    const serviceId = searchParams.get('service_id') ?? routeState.serviceId ?? null;
    if (!patient && requested) { setPatient(requested); setStep(1); }
    else if (!patient && patientId && !loadingPatients) {
      const local = pacientes.find(item => item.id === patientId);
      if (local) { setPatient(local); setStep(1); }
      else { let active = true; void getById(patientId).then(remote => { if (active && remote) { setPatient(remote); setStep(1); } }); return () => { active = false; }; }
    }
    if (nextAppointment) setAppointmentId(nextAppointment);
    if (serviceId && !loadingServices && !services.length) { const service = servicos.find(item => item.id === serviceId); if (service) setServices([service]); }
  }, [getById, loadingPatients, loadingServices, pacientes, patient, routeState.appointmentId, routeState.patient, routeState.patientId, routeState.serviceId, searchParams, services.length, servicos]);

  useEffect(() => {
    const selected = new Set(services.map(service => service.id));
    setCoverage(current => Object.fromEntries(Object.entries(current).filter(([id]) => selected.has(id))));
    setCourtesy(current => Object.fromEntries(Object.entries(current).filter(([id]) => selected.has(id))));
    setPrices(current => Object.fromEntries(services.map(service => [service.id, current[service.id] ?? service.price])));
  }, [services]);

  useEffect(() => {
    const serviceId = searchParams.get('service_id') ?? routeState.serviceId ?? null;
    if (!serviceId || loadingEntitlements || coverage[serviceId]) return;
    const matches = entitlements.filter(item => item.service_id === serviceId && item.effective_status === 'active' && item.available_balance >= 1);
    if (matches.length === 1 && services.some(service => service.id === serviceId)) setCoverage(current => ({ ...current, [serviceId]: matches[0].package_item_id }));
  }, [coverage, entitlements, loadingEntitlements, routeState.serviceId, searchParams, services]);

  useEffect(() => {
    if (!patient || loadingServices || restoredRef.current === patient.id) return;
    restoredRef.current = patient.id;
    let active = true;
    void draft.load().then(row => {
      if (!active || !row) return;
      const payload = row.payload ?? {};
      const restoredServices = (payload.serviceIds ?? []).map(id => servicos.find(service => service.id === id)).filter((service): service is Service => Boolean(service));
      if (restoredServices.length) setServices(restoredServices);
      if (payload.performedDate) setPerformedDate(payload.performedDate);
      if (typeof payload.notes === 'string') setNotes(payload.notes);
      if (payload.coverageByService) setCoverage(payload.coverageByService);
      if (payload.finalPriceByService) setPrices(payload.finalPriceByService);
      if (payload.courtesyByService) setCourtesy(payload.courtesyByService);
      if (Array.isArray(payload.materials)) setMaterials(payload.materials as SelectedAttendanceMaterial[]);
      if (payload.paymentTiming) setTiming(payload.paymentTiming);
      if (Array.isArray(payload.payments)) setPayments(payload.payments as PaymentEntryUI[]);
      if (row.appointment_id) setAppointmentId(row.appointment_id);
      toast.success('Rascunho do atendimento restaurado.');
    }).catch(error => console.warn('[attendance-draft:load]', error));
    return () => { active = false; };
  }, [draft, loadingServices, patient, servicos, toast]);

  useEffect(() => {
    if (hasPayment && step === 3 && !payments.length) setPayments([newPayment(amountDue, timing)]);
    if (!hasPayment && payments.length) setPayments([]);
  }, [amountDue, hasPayment, payments.length, step, timing]);

  useEffect(() => { if (!hasInjectables) { clearAttendanceInjectableDraft(); clearAttendanceInjectablePoints(); setInjectablePoints([]); setInjectablesDone(false); } }, [hasInjectables]);

  const invalidatePaymentAllocation = () => setPayments([]);
  const toggleTreatment = (service: Service, entitlement: PatientEntitlement) => {
    invalidatePaymentAllocation();
    if (coverage[service.id] === entitlement.package_item_id) { setCoverage(current => { const next = { ...current }; delete next[service.id]; return next; }); setServices(current => current.filter(item => item.id !== service.id)); return; }
    setServices(current => current.some(item => item.id === service.id) ? current : [...current, service]);
    setCoverage(current => ({ ...current, [service.id]: entitlement.package_item_id }));
    setCourtesy(current => { const next = { ...current }; delete next[service.id]; return next; });
  };
  const toggleExtra = (service: Service) => { if (!coverage[service.id]) { invalidatePaymentAllocation(); setServices(current => current.some(item => item.id === service.id) ? current.filter(item => item.id !== service.id) : [...current, service]); } };
  const goBack = () => step === 4 && !hasPayment ? setStep(2) : setStep(current => Math.max(0, current - 1));
  const continueFlow = () => { if (step === 1 && hasInjectables && !injectablesDone) { setInjectablesOpen(true); return; } if (step === 2 && !hasPayment) { setStep(4); return; } setStep(current => current + 1); };
  const allocated = payments.reduce((sum, entry) => sum + entry.baseValue, 0);
  const balanced = Math.abs(amountDue - allocated) < .01;
  const futureDatesValid = timing === 'today' || payments.every(entry => entry.scheduledDate > TODAY);
  const canContinue = step === 0 ? Boolean(patient) : step === 1 ? services.length > 0 && performedDate <= TODAY : step === 3 ? !loadingMachine && !machineError && payments.length > 0 && balanced && futureDatesValid : true;

  const saveDraftNow = async () => {
    if (!patient) return;
    const payload: AttendanceDraftPayload = { performedDate, notes, serviceIds: services.map(service => service.id), coverageByService: coverage, finalPriceByService: prices, courtesyByService: courtesy, materials, paymentTiming: timing, payments };
    try { await draft.save(payload, appointmentId); toast.success('Rascunho salvo. Você pode continuar depois.'); } catch (error) { console.error('[attendance-draft:save]', error); toast.error('Não foi possível salvar o rascunho.'); }
  };

  const confirmAttendance = async () => {
    if (!patient || !services.length || (hasPayment && (!balanced || !futureDatesValid))) return;
    setSaving(true);
    try {
      const computed = payments.map(payment => ({ payment, ...paymentAmounts(payment, machine.rates) }));
      const paymentMethod: PaymentMethod = payments.length === 1 ? payments[0].method : 'split';
      const giftNames = services.filter(service => !coverage[service.id] && courtesy[service.id]).map(service => service.name);
      const persistedNotes = [notes.trim(), giftNames.length ? `Brinde/cortesia: ${giftNames.join(', ')}.` : ''].filter(Boolean).join('\n');
      const procedure = await create({
        patient_id: patient.id,
        appointment_id: appointmentId,
        performed_at: new Date(`${performedDate}T12:00:00`).toISOString(),
        services_ids: services.map(service => service.id),
        total_value: amountDue,
        total_cost: services.reduce((sum, service) => sum + service.cost_per_unit, 0),
        payment_method: paymentMethod,
        card_fee_pct: null,
        card_fee_value: computed.reduce((sum, row) => sum + row.feeValue, 0) || null,
        net_value: timing === 'today' ? computed.reduce((sum, row) => sum + row.netAmount, 0) : 0,
        notes: persistedNotes || null,
        payment_entries: hasPayment ? computed.map(({ payment, clientPays, feePct, feeValue, netAmount }) => ({ method: payment.method, amount: clientPays, card_brand: payment.method === 'cartao_credito' || payment.method === 'cartao_debito' ? payment.cardBrand : null, installments: payment.method === 'cartao_credito' ? payment.installments : 1, fee_pct: feePct || null, fee_value: feeValue || null, net_amount: netAmount, absorve_taxa: payment.absorveTaxa, scheduled_date: timing === 'later' ? payment.scheduledDate : null, is_immediate: timing === 'today' })) : [],
        coverage_entries: services.flatMap(service => coverage[service.id] ? [{ service_id: service.id, package_item_id: coverage[service.id]!, quantity: 1 }] : []),
        material_entries: materials.map(item => ({ material_id: item.material_id, quantity: item.quantity })),
        item_values: services.map(service => ({ service_id: service.id, qty: 1, final_price: coverage[service.id] ? service.price : courtesy[service.id] ? 0 : Number(prices[service.id] ?? service.price) })),
      });
      if (injectablePoints.length) await saveInjectables(patient.id, injectablePoints, procedure.id);
      try { await draft.remove(); } catch (cleanupError) { console.warn('[attendance-draft:cleanup]', cleanupError); }
      setDone(true);
    } catch (error) {
      console.error('[attendance:create]', error);
      const raw = error instanceof Error ? error.message : '';
      if (raw.includes('ATTENDANCE_PACKAGE_INSUFFICIENT_BALANCE')) toast.error('Essa sessão não está mais disponível no tratamento.');
      else if (raw.includes('MATERIAL_INSUFFICIENT_STOCK')) toast.error('Estoque insuficiente para um dos materiais.');
      else toast.error('Não foi possível finalizar o atendimento.');
    } finally { setSaving(false); }
  };

  const reset = () => { clearAttendanceInjectableDraft(); clearAttendanceInjectablePoints(); restoredRef.current = null; setStep(0); setPatient(null); setServices([]); setMaterials([]); setAppointmentId(null); setCoverage({}); setPrices({}); setCourtesy({}); setPerformedDate(TODAY); setNotes(''); setTiming('today'); setPayments([]); setInjectablePoints([]); setInjectablesOpen(false); setInjectablesDone(false); setDone(false); };

  if (done) return <div className="page"><div style={{ minHeight: '62vh', display: 'grid', placeItems: 'center', padding: 30 }}><div style={{ maxWidth: 520, textAlign: 'center' }}><div style={{ width: 68, height: 68, margin: '0 auto 14px', borderRadius: '50%', background: '#dcfce7', color: '#166534', display: 'grid', placeItems: 'center' }}><Check size={34}/></div><h2>Atendimento registrado</h2><p className="page-sub">{patient?.name} · {new Date(`${performedDate}T12:00:00`).toLocaleDateString('pt-BR')}</p>{hasPayment && timing === 'later' && <div style={{ margin: '14px 0', padding: 12, border: '1px solid #fde68a', borderRadius: 10, background: '#fffbeb', color: '#92400e' }}><strong>Pagamento em A receber</strong><div>O atendimento foi concluído sem marcar o valor como recebido.</div></div>}<div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}><button type="button" className="btn btn--secondary btn--md" onClick={() => patient ? navigate(`/pacientes/${patient.id}`) : navigate('/pacientes')}>Voltar à paciente</button><button type="button" className="btn-primary" style={{ padding: '12px 24px' }} onClick={reset}>Novo atendimento</button></div></div></div></div>;

  return <div className="page"><div className="page-header"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{step > 0 && <button type="button" className="icon-btn" onClick={goBack} aria-label="Voltar"><ChevronLeft size={21}/></button>}<div><h1 className="page-title">Registrar atendimento</h1>{patient && step > 0 && <p className="page-sub">{patient.name}</p>}</div></div>{patient && step > 0 && <div style={{ display: 'flex', gap: 6 }}><button type="button" className="btn btn--ghost btn--sm" onClick={() => void saveDraftNow()} disabled={draft.saving}><Save size={15}/> {draft.saving ? 'Salvando…' : 'Salvar rascunho'}</button><button type="button" className="icon-btn" onClick={reset} aria-label="Cancelar"><X size={19}/></button></div>}</div>{injectablesOpen && patient && <Suspense fallback={<div className="full-loader">Carregando mapa…</div>}><InjetaveisScreen patientId={patient.id} injectableServices={services.filter(service => service.is_injectable)} onDone={points => { setInjectablePoints(points); setInjectablesDone(true); setInjectablesOpen(false); setStep(2); }} onCancel={() => { setInjectablesDone(false); setInjectablesOpen(false); setStep(1); }} onSkip={() => { setInjectablePoints([]); setInjectablesDone(true); setInjectablesOpen(false); setStep(2); }}/></Suspense>}<div style={{ padding: '0 16px 110px' }}><StepBar step={step} hasInjectables={hasInjectables} hasPayment={hasPayment}/>{step === 0 && <PatientStep onSelect={selected => { setPatient(selected); setStep(1); }}/>} {step === 1 && <><section style={{ padding: 14, marginBottom: 18, border: '1px solid var(--border)', borderRadius: 13, background: 'var(--bg-2)' }}><div style={{ display: 'flex', gap: 8, marginBottom: 12 }}><CalendarDays size={17} style={{ color: 'var(--primary)' }}/><div><strong>Dados do atendimento</strong><div className="page-sub">Pode preencher depois e informar a data real.</div></div></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}><div><label className="field-label">Data do atendimento</label><input className="field-input" type="date" max={TODAY} value={performedDate} onChange={event => setPerformedDate(event.target.value)}/></div><div><label className="field-label">Observações</label><textarea className="field-input" rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Observações clínicas ou administrativas…"/></div></div></section><TreatmentExecutionStep catalogServices={servicos} loadingServices={loadingServices} selected={services} entitlements={entitlements} loadingEntitlements={loadingEntitlements} coverageByService={coverage} onTreatmentToggle={toggleTreatment} onExtraToggle={toggleExtra}/><ServiceAdjustments services={services} coverage={coverage} prices={prices} courtesy={courtesy} setPrice={(id, value) => { invalidatePaymentAllocation(); setPrices(current => ({ ...current, [id]: value })); setCourtesy(current => ({ ...current, [id]: false })); }} setCourtesy={(service, value) => { invalidatePaymentAllocation(); setCourtesy(current => ({ ...current, [service.id]: value })); if (!value) setPrices(current => ({ ...current, [service.id]: current[service.id] ?? service.price })); }}/></>} {step === 2 && <MaterialsStep selected={materials} onChange={setMaterials}/>} {step === 3 && hasPayment && <><FinancialStep amount={amountDue} entries={payments} setEntries={setPayments} rates={machine.rates} timing={timing} setTiming={setTiming} onEditAmount={() => setStep(1)}/>{machineError && <div className="empty-state" style={{ marginTop: 10 }}>{machineError}</div>}</>} {step === 4 && patient && <div><h2 style={{ fontSize: '1.15rem' }}>Confirmar atendimento</h2><p className="page-sub">{new Date(`${performedDate}T12:00:00`).toLocaleDateString('pt-BR')} · {services.length} item(ns)</p><div style={{ margin: '14px 0', padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-2)', display: 'grid', gap: 8 }}>{services.map(service => { const entitlement = entitlements.find(item => item.package_item_id === coverage[service.id]); return <div key={service.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span><strong>{service.name}</strong>{coverage[service.id] && <small style={{ display: 'block', color: '#166534' }}>JÁ PAGO · {entitlement ? treatmentSessionLabel(entitlement) : 'tratamento'}</small>}{courtesy[service.id] && <small style={{ display: 'block', color: '#9d174d' }}>BRINDE / CORTESIA</small>}</span><strong>{coverage[service.id] ? 'Já pago' : courtesy[service.id] ? 'R$ 0,00' : money(prices[service.id] ?? service.price)}</strong></div>; })}<div style={{ paddingTop: 9, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}><span>{hasPayment ? timing === 'later' ? 'A receber' : 'Recebido hoje' : 'Nova cobrança'}</span><strong style={{ color: timing === 'later' ? '#b45309' : 'var(--primary)' }}>{money(amountDue)}</strong></div></div><button type="button" className="btn-primary" style={{ width: '100%', minHeight: 52, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }} disabled={saving} onClick={() => void confirmAttendance()}>{saving ? <Loader2 className="spin" size={19}/> : <Check size={19}/>} {saving ? 'Finalizando…' : 'Finalizar atendimento'}</button></div>} {step < 4 && <button type="button" className="btn-primary" style={{ position: 'fixed', zIndex: 20, bottom: 'calc(var(--tab-h) + 16px)', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 32px)', maxWidth: 640, minHeight: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: canContinue ? 1 : .45, pointerEvents: canContinue ? 'auto' : 'none' }} disabled={!canContinue} onClick={continueFlow}>Continuar <ChevronRight size={18}/></button>}</div></div>;
}
