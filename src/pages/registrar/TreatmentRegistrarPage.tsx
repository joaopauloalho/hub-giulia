import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLocation, useSearchParams } from 'react-router-dom';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { useProcedures } from '../../hooks/useProcedures';
import { useInjetaveis } from '../../hooks/useInjetaveis';
import { useMaquininhaConfig, getFeePct } from '../../hooks/useMaquininhaConfig';
import { usePatientEntitlements } from '../../hooks/usePackages';
import { useToast } from '../../hooks/useToast';
import { clearAttendanceInjectableDraft, clearAttendanceInjectablePoints } from '../../lib/attendanceRuntime';
import { treatmentSessionLabel } from '../../lib/treatmentExecution';
import type { Patient, Service, PaymentMethod, MaquininhaRates, PaymentEntryUI, CardBrand, SimplePaymentMethod, InjectablePoint } from '../../types';
import type { PatientEntitlement } from '../../types/packages';
import { MaterialsStep, type SelectedAttendanceMaterial } from './MaterialsStep';
import { TreatmentExecutionStep } from './TreatmentExecutionStep';

const InjetaveisScreen = lazy(() => import('./InjetaveisScreen').then(module => ({ default: module.InjetaveisScreen })));

const TODAY = format(new Date(), 'yyyy-MM-dd');
const METHOD_LABELS: Record<SimplePaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_credito: 'Crédito',
  cartao_debito: 'Débito',
};

function mkEntry(amount: number): PaymentEntryUI {
  return {
    tempId: Math.random().toString(36).slice(2, 10),
    method: 'pix',
    baseValue: amount,
    cardBrand: 'master_visa',
    installments: 1,
    absorveTaxa: true,
    scheduledDate: TODAY,
  };
}

function computeEntry(entry: PaymentEntryUI, rates: MaquininhaRates) {
  const feePct = getFeePct(rates, entry.method, entry.cardBrand, entry.installments);
  if (feePct === 0) return { feePct: 0, clientPays: entry.baseValue, feeValue: 0, netAmount: entry.baseValue };
  if (entry.absorveTaxa) {
    const clientPays = entry.baseValue;
    const feeValue = clientPays * feePct / 100;
    return { feePct, clientPays, feeValue, netAmount: clientPays - feeValue };
  }
  const netAmount = entry.baseValue;
  const clientPays = netAmount / (1 - feePct / 100);
  const feeValue = clientPays - netAmount;
  return { feePct, clientPays, feeValue, netAmount };
}

function selectedCoverageValue(services: Service[], coverageByService: Record<string, string | undefined>) {
  return services.reduce((total, service) => total + (coverageByService[service.id] ? service.price : 0), 0);
}

function StepBar({ step, hasInjectables, hasPayment }: { step: number; hasInjectables: boolean; hasPayment: boolean }) {
  const labels = ['Paciente', 'Tratamento', ...(hasInjectables ? ['Injetáveis'] : []), 'Materiais', ...(hasPayment ? ['Pagamento'] : []), 'Confirmar'];
  const currentIndex = step === 0
    ? 0
    : step === 1
      ? 1
      : step === 2
        ? 2 + (hasInjectables ? 1 : 0)
        : step === 3
          ? 3 + (hasInjectables ? 1 : 0)
          : labels.length - 1;

  return <div style={{ display: 'flex', gap: 4, marginBottom: 22 }} aria-label="Etapas do atendimento">
    {labels.map((label, index) => <div key={label} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div style={{ height: 4, borderRadius: 999, background: index <= currentIndex ? 'var(--primary)' : 'var(--border)' }}/>
      <span style={{ display: 'block', marginTop: 4, fontSize: '.61rem', whiteSpace: 'nowrap', color: index === currentIndex ? 'var(--primary)' : 'var(--text-3)', fontWeight: index === currentIndex ? 700 : 400 }}>{label}</span>
    </div>)}
  </div>;
}

function StepPatient({ onSelect }: { onSelect: (patient: Patient) => void }) {
  const [query, setQuery] = useState('');
  const { pacientes, loading, nextPage, hasMore } = usePacientes({ search: query });
  return <div>
    <h2 style={{ fontSize: '1.1rem', marginBottom: 5 }}>Selecione a paciente</h2>
    <p className="page-sub" style={{ marginBottom: 14 }}>Abra o atendimento de hoje a partir da paciente.</p>
    <input className="field-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone…" autoFocus style={{ marginBottom: 14 }}/>
    {loading ? <div style={{ padding: 34, textAlign: 'center' }}><Loader2 className="spin" size={24}/></div> : <div style={{ display: 'grid', gap: 8 }}>
      {pacientes.map(patient => <button type="button" key={patient.id} onClick={() => onSelect(patient)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', padding: '14px 15px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-2)', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span><strong style={{ display: 'block', fontSize: '.9rem' }}>{patient.name}</strong>{patient.phone && <small className="page-sub">{patient.phone}</small>}</span><ChevronRight size={18}/>
      </button>)}
      {pacientes.length === 0 && <div className="empty-state">Nenhuma paciente encontrada.</div>}
      {hasMore && <button type="button" className="btn btn--secondary btn--md" onClick={nextPage}>Carregar mais</button>}
    </div>}
  </div>;
}

function PaymentEntryCard({ entry, index, rates, canRemove, onChange, onRemove }: { entry: PaymentEntryUI; index: number; rates: MaquininhaRates; canRemove: boolean; onChange: (entry: PaymentEntryUI) => void; onRemove: () => void }) {
  const computed = computeEntry(entry, rates);
  const isCard = entry.method === 'cartao_credito' || entry.method === 'cartao_debito';
  return <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-2)', display: 'grid', gap: 11 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><strong>Pagamento {index + 1}</strong>{canRemove && <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remover pagamento ${index + 1}`}><Trash2 size={15}/></button>}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }}>
      {(Object.entries(METHOD_LABELS) as [SimplePaymentMethod, string][]).map(([method, label]) => <button type="button" key={method} className={`btn btn--sm ${entry.method === method ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, method, installments: 1 })}>{label}</button>)}
    </div>
    <div><label className="field-label">Valor</label><input className="field-input" inputMode="decimal" type="number" min="0" step="0.01" value={entry.baseValue || ''} onChange={event => onChange({ ...entry, baseValue: Number(event.target.value) || 0 })}/></div>
    {isCard && <div><label className="field-label">Bandeira</label><div style={{ display: 'flex', gap: 7 }}>{(['master_visa', 'elo'] as CardBrand[]).map(brand => <button type="button" key={brand} className={`btn btn--sm ${entry.cardBrand === brand ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, cardBrand: brand })}>{brand === 'master_visa' ? 'Master / Visa' : 'Elo'}</button>)}</div></div>}
    {entry.method === 'cartao_credito' && <div><label className="field-label">Parcelas</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{Array.from({ length: 18 }, (_, i) => i + 1).map(value => <button type="button" key={value} className={`btn btn--sm ${entry.installments === value ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, installments: value })}>{value}x</button>)}</div></div>}
    {computed.feePct > 0 && <div><label className="field-label">Taxa da maquininha</label><div style={{ display: 'flex', gap: 7, marginBottom: 7 }}><button type="button" className={`btn btn--sm ${entry.absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, absorveTaxa: true })}>Clínica absorve</button><button type="button" className={`btn btn--sm ${!entry.absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, absorveTaxa: false })}>Repassar</button></div><div className="page-sub">Cliente paga R$ {computed.clientPays.toFixed(2)} · taxa R$ {computed.feeValue.toFixed(2)} · líquido R$ {computed.netAmount.toFixed(2)}</div></div>}
    <div><label className="field-label">{entry.scheduledDate > TODAY ? 'Data combinada' : 'Data do pagamento'}</label><input className="field-input" type="date" value={entry.scheduledDate} onChange={event => onChange({ ...entry, scheduledDate: event.target.value })}/></div>
  </div>;
}

function PaymentStep({ amountDue, entries, onEntries, rates }: { amountDue: number; entries: PaymentEntryUI[]; onEntries: (entries: PaymentEntryUI[]) => void; rates: MaquininhaRates }) {
  const allocated = entries.reduce((sum, entry) => sum + entry.baseValue, 0);
  const remaining = +(amountDue - allocated).toFixed(2);
  return <div>
    <span style={{ display: 'inline-flex', padding: '5px 9px', borderRadius: 999, background: '#fff7ed', color: '#b45309', fontSize: '.7rem', fontWeight: 800, marginBottom: 7 }}>COBRANÇA EXTRA</span>
    <h2 style={{ fontSize: '1.15rem', marginBottom: 5 }}>Pagamento adicional</h2>
    <p className="page-sub" style={{ marginBottom: 16 }}>As sessões do tratamento já estão pagas. Aqui entra somente o que foi realizado fora do plano.</p>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 13, borderRadius: 11, background: '#fdf2f8', border: '1px solid #fbcfe8', marginBottom: 14 }}><span style={{ fontSize: '.82rem' }}>A cobrar agora</span><strong style={{ color: 'var(--primary)' }}>R$ {amountDue.toFixed(2)}</strong></div>
    <div style={{ display: 'grid', gap: 10 }}>{entries.map((entry, index) => <PaymentEntryCard key={entry.tempId} entry={entry} index={index} rates={rates} canRemove={entries.length > 1} onChange={updated => onEntries(entries.map((item, itemIndex) => itemIndex === index ? updated : item))} onRemove={() => onEntries(entries.filter((_, itemIndex) => itemIndex !== index))}/>)}</div>
    <button type="button" className="btn btn--secondary btn--md" style={{ marginTop: 10 }} onClick={() => onEntries([...entries, mkEntry(remaining > 0 ? remaining : 0)])}><Plus size={15}/> Adicionar forma de pagamento</button>
    <div style={{ marginTop: 10, padding: 10, borderRadius: 9, textAlign: 'center', fontSize: '.78rem', fontWeight: 700, background: Math.abs(remaining) < .01 ? '#f0fdf4' : '#fffbeb', color: Math.abs(remaining) < .01 ? '#166534' : '#b45309' }}>{Math.abs(remaining) < .01 ? '✓ Valor alocado' : remaining > 0 ? `Falta R$ ${remaining.toFixed(2)}` : `Excede R$ ${Math.abs(remaining).toFixed(2)}`}</div>
  </div>;
}

function ConfirmStep({ patient, services, materials, entries, rates, entitlements, coverageByService, amountDue, saving, onConfirm }: { patient: Patient; services: Service[]; materials: SelectedAttendanceMaterial[]; entries: PaymentEntryUI[]; rates: MaquininhaRates; entitlements: PatientEntitlement[]; coverageByService: Record<string, string | undefined>; amountDue: number; saving: boolean; onConfirm: () => void }) {
  const entitlementById = new Map(entitlements.map(item => [item.package_item_id, item]));
  const coveredItems = services.filter(service => coverageByService[service.id]);
  const extraItems = services.filter(service => !coverageByService[service.id]);
  const materialsCost = materials.reduce((sum, item) => sum + item.quantity * item.material.unit_cost, 0);
  const clinicalCost = services.reduce((sum, service) => sum + service.cost_per_unit, 0) + materialsCost;
  const paymentRows = entries.map(entry => ({ entry, ...computeEntry(entry, rates) }));

  return <div>
    <h2 style={{ fontSize: '1.15rem', marginBottom: 5 }}>Confirmar atendimento</h2>
    <p className="page-sub" style={{ marginBottom: 15 }}>Revise o que foi realizado hoje antes de registrar.</p>
    <div style={{ border: '1px solid var(--border)', borderRadius: 13, overflow: 'hidden', background: 'var(--bg-2)' }}>
      <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><small className="page-sub">Paciente</small><strong style={{ display: 'block', marginTop: 2 }}>{patient.name}</strong></section>
      {coveredItems.length > 0 && <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><small className="page-sub">Tratamento já pago</small><div style={{ display: 'grid', gap: 9, marginTop: 8 }}>{coveredItems.map(service => { const entitlement = entitlementById.get(coverageByService[service.id]!); return <div key={service.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><span><strong style={{ display: 'block', fontSize: '.86rem' }}>{service.name}</strong><small style={{ color: '#166534', fontWeight: 700 }}>{entitlement ? `${treatmentSessionLabel(entitlement)} · ${entitlement.package_title}` : 'Coberto pelo tratamento'}</small></span><span style={{ color: '#166534', fontWeight: 800, fontSize: '.76rem' }}>JÁ PAGO</span></div>; })}</div></section>}
      {extraItems.length > 0 && <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><small className="page-sub">Procedimentos extras</small><div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{extraItems.map(service => <div key={service.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '.84rem' }}><span>{service.name}</span><strong>R$ {service.price.toFixed(2)}</strong></div>)}</div></section>}
      {materials.length > 0 && <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><small className="page-sub">Materiais utilizados</small><div style={{ display: 'grid', gap: 5, marginTop: 7 }}>{materials.map(item => <div key={item.material_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}><span>{item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}× {item.material.name}</span><span>R$ {(item.quantity * item.material.unit_cost).toFixed(2)}</span></div>)}</div></section>}
      <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}>
        {amountDue <= .01 ? <div style={{ padding: 11, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}><strong style={{ display: 'block', fontSize: '.84rem' }}>Nenhuma cobrança neste atendimento</strong><span style={{ fontSize: '.74rem' }}>O pagamento destas sessões foi registrado quando o tratamento foi vendido.</span></div> : <><small className="page-sub">Pagamento adicional</small><div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{paymentRows.map(({ entry, clientPays }) => <div key={entry.tempId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem' }}><span>{METHOD_LABELS[entry.method]}{entry.method === 'cartao_credito' ? ` ${entry.installments}x` : ''}</span><strong>R$ {clientPays.toFixed(2)}</strong></div>)}</div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)' }}><span style={{ fontSize: '.82rem' }}>A cobrar agora</span><strong style={{ color: 'var(--primary)' }}>R$ {amountDue.toFixed(2)}</strong></div></>}
      </section>
      <section style={{ padding: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem' }}><span className="page-sub">Custo clínico registrado hoje</span><strong>R$ {clinicalCost.toFixed(2)}</strong></div></section>
    </div>
    <div style={{ textAlign: 'center', margin: '13px 0', fontSize: '.75rem', color: 'var(--text-3)' }}>{format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</div>
    <button type="button" className="btn-primary" style={{ width: '100%', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={saving} onClick={onConfirm}>{saving ? <Loader2 className="spin" size={19}/> : <Check size={19}/>} {saving ? 'Salvando…' : 'Confirmar atendimento'}</button>
  </div>;
}

export function TreatmentRegistrarPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { create } = useProcedures();
  const { pacientes, loading: loadingPatients, getById } = usePacientes();
  const { servicos, loading: loadingServices } = useServicos();
  const { config: machineConfig, loading: loadingMachine, error: machineError } = useMaquininhaConfig();
  const { save: saveInjectables } = useInjetaveis();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [materials, setMaterials] = useState<SelectedAttendanceMaterial[]>([]);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentEntryUI[]>([]);
  const [coverageByService, setCoverageByService] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [injectablePoints, setInjectablePoints] = useState<InjectablePoint[]>([]);
  const [injectablesOpen, setInjectablesOpen] = useState(false);
  const [injectablesDone, setInjectablesDone] = useState(false);

  const { data: entitlements, loading: loadingEntitlements } = usePatientEntitlements(patient?.id);
  const hasInjectables = services.some(service => service.is_injectable);
  const totalServices = services.reduce((sum, service) => sum + service.price, 0);
  const coveredValue = selectedCoverageValue(services, coverageByService);
  const amountDue = Math.max(0, +(totalServices - coveredValue).toFixed(2));
  const hasPayment = amountDue > .01;
  const routeState = (location.state ?? {}) as { patient?: Patient; patientId?: string; appointmentId?: string; serviceId?: string | null };

  useEffect(() => {
    const requestedPatient = routeState.patient;
    const patientId = searchParams.get('patient_id') ?? routeState.patientId ?? requestedPatient?.id;
    const nextAppointmentId = searchParams.get('appointment_id') ?? routeState.appointmentId ?? null;
    const serviceId = searchParams.get('service_id') ?? routeState.serviceId ?? null;
    if (!patient && requestedPatient) { setPatient(requestedPatient); setStep(1); }
    else if (!patient && patientId && !loadingPatients) {
      const local = pacientes.find(item => item.id === patientId);
      if (local) { setPatient(local); setStep(1); }
      else { let active = true; void getById(patientId).then(remote => { if (active && remote) { setPatient(remote); setStep(1); } }); return () => { active = false; }; }
    }
    if (nextAppointmentId) setAppointmentId(nextAppointmentId);
    if (serviceId && !loadingServices && services.length === 0) {
      const requestedService = servicos.find(item => item.id === serviceId);
      if (requestedService) setServices([requestedService]);
    }
  }, [getById, loadingPatients, loadingServices, pacientes, patient, routeState.appointmentId, routeState.patient, routeState.patientId, routeState.serviceId, searchParams, services.length, servicos]);

  useEffect(() => {
    const selected = new Set(services.map(service => service.id));
    setCoverageByService(current => Object.fromEntries(Object.entries(current).filter(([serviceId]) => selected.has(serviceId))));
  }, [services]);

  useEffect(() => {
    const serviceId = searchParams.get('service_id') ?? routeState.serviceId ?? null;
    if (!serviceId || loadingEntitlements || coverageByService[serviceId]) return;
    const matches = entitlements.filter(item => item.service_id === serviceId && item.effective_status === 'active' && item.available_balance >= 1);
    if (matches.length === 1 && services.some(service => service.id === serviceId)) {
      setCoverageByService(current => ({ ...current, [serviceId]: matches[0].package_item_id }));
    }
  }, [coverageByService, entitlements, loadingEntitlements, routeState.serviceId, searchParams, services]);

  useEffect(() => {
    if (hasPayment && step === 3 && payments.length === 0) setPayments([mkEntry(amountDue)]);
    if (!hasPayment && payments.length > 0) setPayments([]);
  }, [amountDue, hasPayment, payments.length, step]);

  useEffect(() => {
    if (hasInjectables) return;
    clearAttendanceInjectableDraft();
    clearAttendanceInjectablePoints();
    setInjectablePoints([]);
    setInjectablesDone(false);
  }, [hasInjectables]);

  const toggleTreatmentSession = (service: Service, entitlement: PatientEntitlement) => {
    const selectedHere = coverageByService[service.id] === entitlement.package_item_id;
    if (selectedHere) {
      setCoverageByService(current => { const next = { ...current }; delete next[service.id]; return next; });
      setServices(current => current.filter(item => item.id !== service.id));
      return;
    }
    setServices(current => current.some(item => item.id === service.id) ? current : [...current, service]);
    setCoverageByService(current => ({ ...current, [service.id]: entitlement.package_item_id }));
  };

  const toggleExtra = (service: Service) => {
    if (coverageByService[service.id]) return;
    setServices(current => current.some(item => item.id === service.id) ? current.filter(item => item.id !== service.id) : [...current, service]);
  };

  const reset = () => {
    clearAttendanceInjectableDraft();
    clearAttendanceInjectablePoints();
    setStep(0);
    setPatient(null);
    setServices([]);
    setMaterials([]);
    setAppointmentId(null);
    setPayments([]);
    setCoverageByService({});
    setDone(false);
    setInjectablePoints([]);
    setInjectablesOpen(false);
    setInjectablesDone(false);
  };

  const goBack = () => {
    if (step === 4 && !hasPayment) setStep(2);
    else setStep(current => Math.max(0, current - 1));
  };

  const handleContinue = () => {
    if (step === 1 && hasInjectables && !injectablesDone) { setInjectablesOpen(true); return; }
    if (step === 2 && !hasPayment) { setStep(4); return; }
    setStep(current => current + 1);
  };

  const allocated = payments.reduce((sum, payment) => sum + payment.baseValue, 0);
  const paymentBalanced = Math.abs(amountDue - allocated) < .01;
  const canContinue = step === 0 ? Boolean(patient) : step === 1 ? services.length > 0 : step === 3 ? !loadingMachine && !machineError && payments.length > 0 && paymentBalanced : true;

  const confirm = async () => {
    if (!patient || services.length === 0 || (hasPayment && (!payments.length || !paymentBalanced))) return;
    setSaving(true);
    try {
      const computed = payments.map(payment => ({ payment, ...computeEntry(payment, machineConfig.rates) }));
      const totalFees = computed.reduce((sum, row) => sum + row.feeValue, 0);
      const immediateNet = computed.filter(row => row.payment.scheduledDate <= TODAY).reduce((sum, row) => sum + row.netAmount, 0);
      const paymentMethod: PaymentMethod = payments.length === 1 ? payments[0].method : 'split';
      const procedure = await create({
        patient_id: patient.id,
        appointment_id: appointmentId,
        services_ids: services.map(service => service.id),
        total_value: amountDue,
        total_cost: services.reduce((sum, service) => sum + service.cost_per_unit, 0),
        payment_method: paymentMethod,
        card_fee_pct: null,
        card_fee_value: totalFees > 0 ? totalFees : null,
        net_value: immediateNet,
        payment_entries: computed.map(({ payment, clientPays, feePct, feeValue, netAmount }) => ({
          method: payment.method,
          amount: clientPays,
          card_brand: payment.method === 'cartao_credito' || payment.method === 'cartao_debito' ? payment.cardBrand : null,
          installments: payment.method === 'cartao_credito' ? payment.installments : 1,
          fee_pct: feePct > 0 ? feePct : null,
          fee_value: feeValue > 0 ? feeValue : null,
          net_amount: netAmount,
          absorve_taxa: payment.absorveTaxa,
          scheduled_date: payment.scheduledDate === TODAY ? null : payment.scheduledDate,
          is_immediate: payment.scheduledDate <= TODAY,
        })),
        coverage_entries: services.flatMap(service => coverageByService[service.id] ? [{ service_id: service.id, package_item_id: coverageByService[service.id]!, quantity: 1 }] : []),
        material_entries: materials.map(item => ({ material_id: item.material_id, quantity: item.quantity })),
        item_values: services.map(service => ({ service_id: service.id, qty: 1, final_price: service.price })),
      });
      if (injectablePoints.length > 0) await saveInjectables(patient.id, injectablePoints, procedure.id);
      setDone(true);
    } catch (error) {
      console.error('[treatment-attendance]', error);
      const raw = error instanceof Error ? error.message : '';
      if (raw.includes('ATTENDANCE_PACKAGE_INSUFFICIENT_BALANCE')) toast.error('Essa sessão já não está mais disponível no tratamento. Atualize e tente novamente.');
      else if (raw.includes('MATERIAL_INSUFFICIENT_STOCK')) toast.error('Estoque insuficiente para um dos materiais selecionados.');
      else toast.error('Não foi possível registrar o atendimento. Tente novamente.');
    } finally { setSaving(false); }
  };

  if (done) {
    const covered = services.flatMap(service => {
      const entitlement = entitlements.find(item => item.package_item_id === coverageByService[service.id]);
      return entitlement ? [`${service.name} · ${treatmentSessionLabel(entitlement)}`] : [];
    });
    return <div className="page"><div style={{ minHeight: '62vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 15, padding: 30, textAlign: 'center' }}>
      <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#dcfce7', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={34} strokeWidth={2.6}/></div>
      <h2 style={{ fontSize: '1.3rem' }}>Atendimento registrado</h2>
      <p className="page-sub">{patient?.name}</p>
      {covered.length > 0 && <div style={{ width: '100%', maxWidth: 520, padding: 13, border: '1px solid #bbf7d0', borderRadius: 11, background: '#f0fdf4', color: '#166534', display: 'grid', gap: 5 }}>{covered.map(label => <strong key={label} style={{ fontSize: '.8rem' }}>{label}</strong>)}</div>}
      {hasPayment ? <p style={{ fontSize: '.8rem', color: 'var(--text-3)' }}>Cobrança adicional registrada separadamente do tratamento.</p> : <p style={{ fontSize: '.8rem', color: '#166534' }}>Nenhuma nova cobrança foi criada.</p>}
      <button type="button" className="btn-primary" style={{ marginTop: 4, padding: '12px 28px' }} onClick={reset}>Novo atendimento</button>
    </div></div>;
  }

  return <div className="page">
    <div className="page-header"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{step > 0 && <button type="button" className="icon-btn" onClick={goBack} aria-label="Voltar"><ChevronLeft size={21}/></button>}<div><h1 className="page-title">Registrar atendimento</h1>{patient && step > 0 && <p className="page-sub">{patient.name}</p>}</div></div>{patient && step > 0 && <button type="button" className="icon-btn" onClick={reset} aria-label="Cancelar atendimento"><X size={19}/></button>}</div>
    {injectablesOpen && patient && <Suspense fallback={<div className="full-loader">Carregando mapa…</div>}><InjetaveisScreen patientId={patient.id} injectableServices={services.filter(service => service.is_injectable)} onDone={points => { setInjectablePoints(points); setInjectablesDone(true); setInjectablesOpen(false); setStep(2); }} onCancel={() => { setInjectablesDone(false); setInjectablesOpen(false); setStep(1); }} onSkip={() => { setInjectablePoints([]); setInjectablesDone(true); setInjectablesOpen(false); setStep(2); }}/></Suspense>}
    <div style={{ padding: '0 16px 110px' }}>
      <StepBar step={step} hasInjectables={hasInjectables} hasPayment={hasPayment}/>
      {step === 0 && <StepPatient onSelect={selected => { setPatient(selected); setStep(1); }}/>} 
      {step === 1 && <TreatmentExecutionStep catalogServices={servicos} loadingServices={loadingServices} selected={services} entitlements={entitlements} loadingEntitlements={loadingEntitlements} coverageByService={coverageByService} onTreatmentToggle={toggleTreatmentSession} onExtraToggle={toggleExtra}/>} 
      {step === 2 && <div><h2 style={{ fontSize: '1.12rem', marginBottom: 5 }}>Materiais utilizados hoje</h2><p className="page-sub" style={{ marginBottom: 14 }}>Selecione apenas o que foi efetivamente consumido neste atendimento.</p><MaterialsStep selected={materials} onChange={setMaterials}/></div>} 
      {step === 3 && hasPayment && <>{machineError && <div className="empty-state" style={{ marginBottom: 12 }}>{machineError}</div>}<PaymentStep amountDue={amountDue} entries={payments} onEntries={setPayments} rates={machineConfig.rates}/></>} 
      {step === 4 && patient && <ConfirmStep patient={patient} services={services} materials={materials} entries={payments} rates={machineConfig.rates} entitlements={entitlements} coverageByService={coverageByService} amountDue={amountDue} saving={saving} onConfirm={() => void confirm()}/>} 
      {step < 4 && <button type="button" className="btn-primary" style={{ position: 'fixed', zIndex: 20, bottom: 'calc(var(--tab-h) + 16px)', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 32px)', maxWidth: 640, padding: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: canContinue ? 1 : .45, pointerEvents: canContinue ? 'auto' : 'none' }} disabled={!canContinue} onClick={handleContinue}>Continuar <ChevronRight size={18}/></button>}
    </div>
  </div>;
}
