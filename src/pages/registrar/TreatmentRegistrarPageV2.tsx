import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Gift,
  Loader2,
  Plus,
  Save,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { useProcedures } from '../../hooks/useProcedures';
import { useInjetaveis } from '../../hooks/useInjetaveis';
import { useMaquininhaConfig, getFeePct } from '../../hooks/useMaquininhaConfig';
import { usePatientEntitlements } from '../../hooks/usePackages';
import { useToast } from '../../hooks/useToast';
import { useAttendanceDraft, type AttendanceDraftPayload } from '../../hooks/useAttendanceDraft';
import { clearAttendanceInjectableDraft, clearAttendanceInjectablePoints } from '../../lib/attendanceRuntime';
import { treatmentSessionLabel } from '../../lib/treatmentExecution';
import type {
  Patient,
  Service,
  PaymentMethod,
  MaquininhaRates,
  PaymentEntryUI,
  CardBrand,
  SimplePaymentMethod,
  InjectablePoint,
} from '../../types';
import type { PatientEntitlement } from '../../types/packages';
import { MaterialsStep, type SelectedAttendanceMaterial } from './MaterialsStep';
import { TreatmentExecutionStep } from './TreatmentExecutionStep';

const InjetaveisScreen = lazy(() => import('./InjetaveisScreen').then(module => ({ default: module.InjetaveisScreen })));

const TODAY = format(new Date(), 'yyyy-MM-dd');
const TOMORROW = format(addDays(new Date(), 1), 'yyyy-MM-dd');
const METHOD_LABELS: Record<SimplePaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_credito: 'Crédito',
  cartao_debito: 'Débito',
};

type PaymentTiming = 'today' | 'later';

function money(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function mkEntry(amount: number, timing: PaymentTiming = 'today'): PaymentEntryUI {
  return {
    tempId: Math.random().toString(36).slice(2, 10),
    method: 'pix',
    baseValue: amount,
    cardBrand: 'master_visa',
    installments: 1,
    absorveTaxa: true,
    scheduledDate: timing === 'today' ? TODAY : '',
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

function StepBar({ step, hasInjectables, hasPayment }: { step: number; hasInjectables: boolean; hasPayment: boolean }) {
  const labels = ['Paciente', 'Atendimento', ...(hasInjectables ? ['Injetáveis'] : []), 'Materiais', ...(hasPayment ? ['Financeiro'] : []), 'Confirmar'];
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
    <p className="page-sub" style={{ marginBottom: 14 }}>Ou abra o atendimento diretamente pela aba Atendimentos da paciente.</p>
    <input className="field-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone…" autoFocus style={{ marginBottom: 14 }}/>
    {loading ? <div style={{ padding: 34, textAlign: 'center' }}><Loader2 className="spin" size={24}/></div> : <div style={{ display: 'grid', gap: 8 }}>
      {pacientes.map(patient => <button type="button" key={patient.id} onClick={() => onSelect(patient)} style={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', padding: '14px 15px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-2)', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <span><strong style={{ display: 'block', fontSize: '.9rem' }}>{patient.name}</strong>{patient.phone && <small className="page-sub">{patient.phone}</small>}</span><ChevronRight size={18}/>
      </button>)}
      {pacientes.length === 0 && <div className="empty-state">Nenhuma paciente encontrada.</div>}
      {hasMore && <button type="button" className="btn btn--secondary btn--md" onClick={nextPage}>Carregar mais</button>}
    </div>}
  </div>;
}

function AttendanceDetails({ performedDate, onPerformedDate, notes, onNotes }: { performedDate: string; onPerformedDate: (value: string) => void; notes: string; onNotes: (value: string) => void }) {
  return <section style={{ marginBottom: 18, padding: 14, border: '1px solid var(--border)', borderRadius: 13, background: 'var(--bg-2)' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><CalendarDays size={17} style={{ color: 'var(--primary)' }}/><div><strong style={{ display: 'block', fontSize: '.88rem' }}>Dados deste atendimento</strong><span className="page-sub">Pode registrar depois e informar a data em que realmente aconteceu.</span></div></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, .55fr) minmax(260px, 1.45fr)', gap: 12 }}>
      <div><label className="field-label">Data do atendimento</label><input className="field-input" type="date" max={TODAY} value={performedDate} onChange={event => onPerformedDate(event.target.value)}/></div>
      <div><label className="field-label">Observações</label><textarea className="field-input" rows={2} value={notes} onChange={event => onNotes(event.target.value)} placeholder="Observações clínicas ou administrativas deste atendimento…"/></div>
    </div>
  </section>;
}

function BillingAdjustments({ services, coverageByService, finalPriceByService, courtesyByService, onPrice, onCourtesy }: {
  services: Service[];
  coverageByService: Record<string, string | undefined>;
  finalPriceByService: Record<string, number>;
  courtesyByService: Record<string, boolean>;
  onPrice: (serviceId: string, value: number) => void;
  onCourtesy: (service: Service, value: boolean) => void;
}) {
  const extras = services.filter(service => !coverageByService[service.id]);
  if (extras.length === 0) return null;

  return <section style={{ marginTop: 18 }}>
    <div style={{ marginBottom: 10 }}><strong style={{ display: 'block', fontSize: '.9rem' }}>Valor realizado hoje</strong><span className="page-sub">O valor padrão vem do catálogo, mas pode ser ajustado para desconto ou marcado como brinde.</span></div>
    <div style={{ display: 'grid', gap: 9 }}>
      {extras.map(service => {
        const courtesy = Boolean(courtesyByService[service.id]);
        const finalPrice = courtesy ? 0 : Number(finalPriceByService[service.id] ?? service.price);
        const discount = Math.max(0, service.price - finalPrice);
        const pct = service.price > 0 ? (discount / service.price) * 100 : 0;
        return <div key={service.id} style={{ padding: 13, border: `1px solid ${courtesy ? '#fbcfe8' : 'var(--border)'}`, borderRadius: 12, background: courtesy ? '#fdf2f8' : 'var(--bg-2)', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}><div><strong style={{ display: 'block', fontSize: '.88rem' }}>{service.name}</strong><small className="page-sub">Catálogo: {money(service.price)}</small></div>{courtesy && <span className="badge" style={{ background: '#fce7f3', color: '#9d174d', fontWeight: 800 }}><Gift size={12}/> BRINDE</span>}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) minmax(180px,auto)', gap: 10, alignItems: 'end' }}>
            <div><label className="field-label">Valor cobrado</label><div style={{ position: 'relative' }}><span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', fontSize: 13 }}>R$</span><input className="field-input" style={{ paddingLeft: 35 }} inputMode="decimal" type="number" min="0" step="0.01" disabled={courtesy} value={courtesy ? 0 : finalPrice} onChange={event => onPrice(service.id, Math.max(0, Number(event.target.value) || 0))}/></div>{!courtesy && discount > .009 && <small style={{ display: 'block', marginTop: 4, color: '#166534', fontWeight: 700 }}><Tag size={11} style={{ verticalAlign: -2, marginRight: 3 }}/>desconto {money(discount)} · {pct.toFixed(0)}%</small>}</div>
            <button type="button" onClick={() => onCourtesy(service, !courtesy)} aria-pressed={courtesy} className={`btn btn--md ${courtesy ? 'btn--primary' : 'btn--ghost'}`} style={{ minHeight: 44 }}><Gift size={16}/> {courtesy ? 'Remover brinde' : 'Marcar como brinde'}</button>
          </div>
        </div>;
      })}
    </div>
  </section>;
}

function PaymentEntryCard({ entry, index, rates, timing, canRemove, onChange, onRemove }: {
  entry: PaymentEntryUI;
  index: number;
  rates: MaquininhaRates;
  timing: PaymentTiming;
  canRemove: boolean;
  onChange: (entry: PaymentEntryUI) => void;
  onRemove: () => void;
}) {
  const computed = computeEntry(entry, rates);
  const isCard = entry.method === 'cartao_credito' || entry.method === 'cartao_debito';
  return <div style={{ padding: 14, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-2)', display: 'grid', gap: 11 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><strong>{timing === 'later' ? 'Recebimento' : 'Pagamento'} {index + 1}</strong>{canRemove && <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Remover forma ${index + 1}`}><Trash2 size={15}/></button>}</div>
    <div><label className="field-label">{timing === 'later' ? 'Forma combinada' : 'Forma de pagamento'}</label><div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }}>{(Object.entries(METHOD_LABELS) as [SimplePaymentMethod, string][]).map(([method, label]) => <button type="button" key={method} className={`btn btn--sm ${entry.method === method ? 'btn--primary' : 'btn--ghost'}`} style={{ minHeight: 42 }} onClick={() => onChange({ ...entry, method, installments: 1 })}>{label}</button>)}</div></div>
    <div><label className="field-label">Valor</label><input className="field-input" inputMode="decimal" type="number" min="0" step="0.01" value={entry.baseValue || ''} onChange={event => onChange({ ...entry, baseValue: Number(event.target.value) || 0 })}/></div>
    {isCard && <div><label className="field-label">Bandeira</label><div style={{ display: 'flex', gap: 7 }}>{(['master_visa', 'elo'] as CardBrand[]).map(brand => <button type="button" key={brand} className={`btn btn--sm ${entry.cardBrand === brand ? 'btn--primary' : 'btn--ghost'}`} style={{ minHeight: 42 }} onClick={() => onChange({ ...entry, cardBrand: brand })}>{brand === 'master_visa' ? 'Master / Visa' : 'Elo'}</button>)}</div></div>}
    {entry.method === 'cartao_credito' && <div><label className="field-label">Parcelas</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{Array.from({ length: 18 }, (_, i) => i + 1).map(value => <button type="button" key={value} className={`btn btn--sm ${entry.installments === value ? 'btn--primary' : 'btn--ghost'}`} style={{ minWidth: 42, minHeight: 40 }} onClick={() => onChange({ ...entry, installments: value })}>{value}x</button>)}</div></div>}
    {computed.feePct > 0 && <div><label className="field-label">Taxa da maquininha</label><div style={{ display: 'flex', gap: 7, marginBottom: 7 }}><button type="button" className={`btn btn--sm ${entry.absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, absorveTaxa: true })}>Clínica absorve</button><button type="button" className={`btn btn--sm ${!entry.absorveTaxa ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onChange({ ...entry, absorveTaxa: false })}>Repassar</button></div><div className="page-sub">Cliente paga {money(computed.clientPays)} · taxa {money(computed.feeValue)} · líquido {money(computed.netAmount)}</div></div>}
    {timing === 'later' && <div><label className="field-label">Previsão de recebimento</label><input className="field-input" type="date" min={TOMORROW} value={entry.scheduledDate} onChange={event => onChange({ ...entry, scheduledDate: event.target.value })}/><small className="page-sub" style={{ display: 'block', marginTop: 4 }}>O atendimento será registrado agora, mas este valor continuará em A receber até você confirmar o pagamento.</small></div>}
  </div>;
}

function PaymentStep({ amountDue, entries, onEntries, rates, timing, onTiming }: {
  amountDue: number;
  entries: PaymentEntryUI[];
  onEntries: (entries: PaymentEntryUI[]) => void;
  rates: MaquininhaRates;
  timing: PaymentTiming;
  onTiming: (timing: PaymentTiming) => void;
}) {
  const allocated = entries.reduce((sum, entry) => sum + entry.baseValue, 0);
  const remaining = +(amountDue - allocated).toFixed(2);
  const chooseTiming = (next: PaymentTiming) => {
    onTiming(next);
    onEntries(entries.length > 0
      ? entries.map(entry => ({ ...entry, scheduledDate: next === 'today' ? TODAY : '' }))
      : [mkEntry(amountDue, next)]);
  };

  return <div>
    <h2 style={{ fontSize: '1.15rem', marginBottom: 5 }}>Situação financeira</h2>
    <p className="page-sub" style={{ marginBottom: 14 }}>O atendimento e o recebimento são eventos diferentes. Registre exatamente o que aconteceu.</p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 9, marginBottom: 16 }}>
      <button type="button" onClick={() => chooseTiming('today')} aria-pressed={timing === 'today'} style={{ minHeight: 84, padding: 13, borderRadius: 13, border: `2px solid ${timing === 'today' ? 'var(--primary)' : 'var(--border)'}`, background: timing === 'today' ? 'var(--bg-2)' : 'var(--bg)', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}><CheckCircle2 size={20} style={{ color: timing === 'today' ? 'var(--primary)' : 'var(--text-3)', marginBottom: 6 }}/><strong style={{ display: 'block' }}>Pago hoje</strong><small className="page-sub">Registra o recebimento agora.</small></button>
      <button type="button" onClick={() => chooseTiming('later')} aria-pressed={timing === 'later'} style={{ minHeight: 84, padding: 13, borderRadius: 13, border: `2px solid ${timing === 'later' ? '#d97706' : 'var(--border)'}`, background: timing === 'later' ? '#fffbeb' : 'var(--bg)', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}><Clock3 size={20} style={{ color: timing === 'later' ? '#b45309' : 'var(--text-3)', marginBottom: 6 }}/><strong style={{ display: 'block' }}>Receber depois</strong><small className="page-sub">Cria um valor em A receber.</small></button>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 13, borderRadius: 11, background: timing === 'later' ? '#fffbeb' : '#fdf2f8', border: `1px solid ${timing === 'later' ? '#fde68a' : '#fbcfe8'}`, marginBottom: 14 }}><span style={{ fontSize: '.82rem' }}>{timing === 'later' ? 'A receber' : 'A receber hoje'}</span><strong style={{ color: timing === 'later' ? '#b45309' : 'var(--primary)' }}>{money(amountDue)}</strong></div>
    <div style={{ display: 'grid', gap: 10 }}>{entries.map((entry, index) => <PaymentEntryCard key={entry.tempId} entry={entry} index={index} rates={rates} timing={timing} canRemove={entries.length > 1} onChange={updated => onEntries(entries.map((item, itemIndex) => itemIndex === index ? updated : item))} onRemove={() => onEntries(entries.filter((_, itemIndex) => itemIndex !== index))}/>)}</div>
    <button type="button" className="btn btn--secondary btn--md" style={{ marginTop: 10, minHeight: 44 }} onClick={() => onEntries([...entries, mkEntry(remaining > 0 ? remaining : 0, timing)])}><Plus size={15}/> Adicionar outra forma</button>
    <div style={{ marginTop: 10, padding: 10, borderRadius: 9, textAlign: 'center', fontSize: '.78rem', fontWeight: 700, background: Math.abs(remaining) < .01 ? '#f0fdf4' : '#fffbeb', color: Math.abs(remaining) < .01 ? '#166534' : '#b45309' }}>{Math.abs(remaining) < .01 ? '✓ Valor alocado' : remaining > 0 ? `Falta ${money(remaining)}` : `Excede ${money(Math.abs(remaining))}`}</div>
  </div>;
}

function ConfirmStep({ patient, services, materials, entries, rates, entitlements, coverageByService, finalPriceByService, courtesyByService, amountDue, paymentTiming, performedDate, notes, saving, onConfirm }: {
  patient: Patient;
  services: Service[];
  materials: SelectedAttendanceMaterial[];
  entries: PaymentEntryUI[];
  rates: MaquininhaRates;
  entitlements: PatientEntitlement[];
  coverageByService: Record<string, string | undefined>;
  finalPriceByService: Record<string, number>;
  courtesyByService: Record<string, boolean>;
  amountDue: number;
  paymentTiming: PaymentTiming;
  performedDate: string;
  notes: string;
  saving: boolean;
  onConfirm: () => void;
}) {
  const entitlementById = new Map(entitlements.map(item => [item.package_item_id, item]));
  const coveredItems = services.filter(service => coverageByService[service.id]);
  const extraItems = services.filter(service => !coverageByService[service.id]);
  const materialsCost = materials.reduce((sum, item) => sum + item.quantity * item.material.unit_cost, 0);
  const clinicalCost = services.reduce((sum, service) => sum + service.cost_per_unit, 0) + materialsCost;
  const paymentRows = entries.map(entry => ({ entry, ...computeEntry(entry, rates) }));

  return <div>
    <h2 style={{ fontSize: '1.15rem', marginBottom: 5 }}>Confirmar atendimento</h2>
    <p className="page-sub" style={{ marginBottom: 15 }}>Revise o que realmente aconteceu antes de finalizar.</p>
    <div style={{ border: '1px solid var(--border)', borderRadius: 13, overflow: 'hidden', background: 'var(--bg-2)' }}>
      <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><small className="page-sub">Paciente · data real</small><strong style={{ display: 'block', marginTop: 2 }}>{patient.name} · {new Date(`${performedDate}T12:00:00`).toLocaleDateString('pt-BR')}</strong></section>
      {coveredItems.length > 0 && <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><small className="page-sub">Tratamento já pago</small><div style={{ display: 'grid', gap: 9, marginTop: 8 }}>{coveredItems.map(service => { const entitlement = entitlementById.get(coverageByService[service.id]!); return <div key={service.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><span><strong style={{ display: 'block', fontSize: '.86rem' }}>{service.name}</strong><small style={{ color: '#166534', fontWeight: 700 }}>{entitlement ? `${treatmentSessionLabel(entitlement)} · ${entitlement.package_title}` : 'Coberto pelo tratamento'}</small></span><span style={{ color: '#166534', fontWeight: 800, fontSize: '.76rem' }}>JÁ PAGO</span></div>; })}</div></section>}
      {extraItems.length > 0 && <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><small className="page-sub">Procedimentos deste atendimento</small><div style={{ display: 'grid', gap: 8, marginTop: 8 }}>{extraItems.map(service => { const courtesy = Boolean(courtesyByService[service.id]); const value = courtesy ? 0 : Number(finalPriceByService[service.id] ?? service.price); return <div key={service.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', fontSize: '.84rem' }}><span>{service.name}{courtesy && <small style={{ display: 'block', color: '#9d174d', fontWeight: 800 }}>BRINDE / CORTESIA</small>}</span><strong style={{ color: courtesy ? '#9d174d' : 'inherit' }}>{courtesy ? 'R$ 0,00' : money(value)}</strong></div>; })}</div></section>}
      {materials.length > 0 && <section style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><small className="page-sub">Materiais utilizados</small><div style={{ display: 'grid', gap: 5, marginTop: 7 }}>{materials.map(item => <div key={item.material_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}><span>{item.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}× {item.material.name}</span><span>{money(item.quantity * item.material.unit_cost)}</span></div>)}</div></section>}
      <section style={{ padding: 14, borderBottom: notes ? '1px solid var(--border)' : 'none' }}>
        {amountDue <= .01 ? <div style={{ padding: 11, borderRadius: 9, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }}><strong style={{ display: 'block', fontSize: '.84rem' }}>Nenhuma nova cobrança</strong><span style={{ fontSize: '.74rem' }}>Sessões já pagas e/ou cortesias não geram recebimento.</span></div> : <><small className="page-sub">{paymentTiming === 'later' ? 'A receber' : 'Recebimento'}</small><div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{paymentRows.map(({ entry, clientPays }) => <div key={entry.tempId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem' }}><span>{METHOD_LABELS[entry.method]}{entry.method === 'cartao_credito' ? ` ${entry.installments}x` : ''}{paymentTiming === 'later' && entry.scheduledDate ? ` · previsto ${new Date(`${entry.scheduledDate}T12:00:00`).toLocaleDateString('pt-BR')}` : ''}</span><strong>{money(clientPays)}</strong></div>)}</div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--border)' }}><span style={{ fontSize: '.82rem' }}>{paymentTiming === 'later' ? 'Ficará pendente' : 'Total recebido'}</span><strong style={{ color: paymentTiming === 'later' ? '#b45309' : 'var(--primary)' }}>{money(amountDue)}</strong></div></>}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', marginTop: 10 }}><span className="page-sub">Custo clínico registrado</span><strong>{money(clinicalCost)}</strong></div>
      </section>
      {notes && <section style={{ padding: 14 }}><small className="page-sub">Observações</small><p style={{ fontSize: '.82rem', marginTop: 4, whiteSpace: 'pre-wrap' }}>{notes}</p></section>}
    </div>
    <button type="button" className="btn-primary" style={{ width: '100%', minHeight: 52, marginTop: 14, padding: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} disabled={saving} onClick={onConfirm}>{saving ? <Loader2 className="spin" size={19}/> : <Check size={19}/>} {saving ? 'Finalizando…' : 'Finalizar atendimento'}</button>
  </div>;
}

export function TreatmentRegistrarPageV2() {
  const location = useLocation();
  const navigate = useNavigate();
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
  const [finalPriceByService, setFinalPriceByService] = useState<Record<string, number>>({});
  const [courtesyByService, setCourtesyByService] = useState<Record<string, boolean>>({});
  const [performedDate, setPerformedDate] = useState(TODAY);
  const [notes, setNotes] = useState('');
  const [paymentTiming, setPaymentTiming] = useState<PaymentTiming>('today');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [injectablePoints, setInjectablePoints] = useState<InjectablePoint[]>([]);
  const [injectablesOpen, setInjectablesOpen] = useState(false);
  const [injectablesDone, setInjectablesDone] = useState(false);
  const restoredDraftPatientRef = useRef<string | null>(null);

  const { data: entitlements, loading: loadingEntitlements } = usePatientEntitlements(patient?.id);
  const draft = useAttendanceDraft(patient?.id);
  const hasInjectables = services.some(service => service.is_injectable);
  const amountDue = useMemo(() => Math.max(0, +services.reduce((sum, service) => {
    if (coverageByService[service.id] || courtesyByService[service.id]) return sum;
    return sum + Number(finalPriceByService[service.id] ?? service.price);
  }, 0).toFixed(2)), [coverageByService, courtesyByService, finalPriceByService, services]);
  const hasPayment = amountDue > .01;
  const routeState = (location.state ?? {}) as { patient?: Patient; patientId?: string; appointmentId?: string; serviceId?: string | null };

  useEffect(() => {
    const requestedPatient = routeState.patient;
    const patientId = searchParams.get('patient_id') ?? searchParams.get('patientId') ?? routeState.patientId ?? requestedPatient?.id;
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
    setCourtesyByService(current => Object.fromEntries(Object.entries(current).filter(([serviceId]) => selected.has(serviceId))));
    setFinalPriceByService(current => {
      const next: Record<string, number> = {};
      for (const service of services) next[service.id] = current[service.id] ?? service.price;
      return next;
    });
  }, [services]);

  useEffect(() => {
    const serviceId = searchParams.get('service_id') ?? routeState.serviceId ?? null;
    if (!serviceId || loadingEntitlements || coverageByService[serviceId]) return;
    const matches = entitlements.filter(item => item.service_id === serviceId && item.effective_status === 'active' && item.available_balance >= 1);
    if (matches.length === 1 && services.some(service => service.id === serviceId)) setCoverageByService(current => ({ ...current, [serviceId]: matches[0].package_item_id }));
  }, [coverageByService, entitlements, loadingEntitlements, routeState.serviceId, searchParams, services]);

  useEffect(() => {
    if (!patient || loadingServices || restoredDraftPatientRef.current === patient.id) return;
    restoredDraftPatientRef.current = patient.id;
    let active = true;
    void draft.load().then(row => {
      if (!active || !row) return;
      const payload = row.payload ?? {};
      const selected = (payload.serviceIds ?? []).map(id => servicos.find(service => service.id === id)).filter((service): service is Service => Boolean(service));
      if (selected.length > 0) setServices(selected);
      if (payload.performedDate) setPerformedDate(payload.performedDate);
      if (typeof payload.notes === 'string') setNotes(payload.notes);
      if (payload.coverageByService) setCoverageByService(payload.coverageByService);
      if (payload.finalPriceByService) setFinalPriceByService(payload.finalPriceByService);
      if (payload.courtesyByService) setCourtesyByService(payload.courtesyByService);
      if (Array.isArray(payload.materials)) setMaterials(payload.materials as SelectedAttendanceMaterial[]);
      if (payload.paymentTiming === 'today' || payload.paymentTiming === 'later') setPaymentTiming(payload.paymentTiming);
      if (Array.isArray(payload.payments)) setPayments(payload.payments as PaymentEntryUI[]);
      if (row.appointment_id) setAppointmentId(row.appointment_id);
      toast.success('Rascunho do atendimento restaurado.');
    }).catch(error => console.warn('[attendance-draft:load]', error));
    return () => { active = false; };
  }, [draft, loadingServices, patient, servicos, toast]);

  useEffect(() => {
    if (hasPayment && step === 3 && payments.length === 0) setPayments([mkEntry(amountDue, paymentTiming)]);
    if (!hasPayment && payments.length > 0) setPayments([]);
  }, [amountDue, hasPayment, paymentTiming, payments.length, step]);

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
    setCourtesyByService(current => { const next = { ...current }; delete next[service.id]; return next; });
  };

  const toggleExtra = (service: Service) => {
    if (coverageByService[service.id]) return;
    setServices(current => current.some(item => item.id === service.id) ? current.filter(item => item.id !== service.id) : [...current, service]);
  };

  const reset = () => {
    clearAttendanceInjectableDraft();
    clearAttendanceInjectablePoints();
    restoredDraftPatientRef.current = null;
    setStep(0);
    setPatient(null);
    setServices([]);
    setMaterials([]);
    setAppointmentId(null);
    setPayments([]);
    setCoverageByService({});
    setFinalPriceByService({});
    setCourtesyByService({});
    setPerformedDate(TODAY);
    setNotes('');
    setPaymentTiming('today');
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
  const paymentDatesValid = paymentTiming === 'today' || payments.every(payment => Boolean(payment.scheduledDate) && payment.scheduledDate > TODAY);
  const canContinue = step === 0
    ? Boolean(patient)
    : step === 1
      ? services.length > 0 && Boolean(performedDate) && performedDate <= TODAY
      : step === 3
        ? !loadingMachine && !machineError && payments.length > 0 && paymentBalanced && paymentDatesValid
        : true;

  const saveDraftNow = async () => {
    if (!patient) return;
    const payload: AttendanceDraftPayload = {
      performedDate,
      notes,
      serviceIds: services.map(service => service.id),
      coverageByService,
      finalPriceByService,
      courtesyByService,
      materials,
      paymentTiming,
      payments,
    };
    try {
      await draft.save(payload, appointmentId);
      toast.success('Rascunho salvo. Você pode continuar depois.');
    } catch (error) {
      console.error('[attendance-draft:save]', error);
      toast.error('Não foi possível salvar o rascunho.');
    }
  };

  const confirm = async () => {
    if (!patient || services.length === 0 || (hasPayment && (!payments.length || !paymentBalanced || !paymentDatesValid))) return;
    setSaving(true);
    try {
      const computed = payments.map(payment => ({ payment, ...computeEntry(payment, machineConfig.rates) }));
      const totalFees = computed.reduce((sum, row) => sum + row.feeValue, 0);
      const immediateNet = paymentTiming === 'today' ? computed.reduce((sum, row) => sum + row.netAmount, 0) : 0;
      const paymentMethod: PaymentMethod = payments.length === 1 ? payments[0].method : 'split';
      const courtesyNames = services.filter(service => !coverageByService[service.id] && courtesyByService[service.id]).map(service => service.name);
      const auditNote = courtesyNames.length > 0 ? `Brinde/cortesia: ${courtesyNames.join(', ')}.` : '';
      const persistedNotes = [notes.trim(), auditNote].filter(Boolean).join('\n');
      const procedure = await create({
        patient_id: patient.id,
        appointment_id: appointmentId,
        performed_at: new Date(`${performedDate}T12:00:00`).toISOString(),
        services_ids: services.map(service => service.id),
        total_value: amountDue,
        total_cost: services.reduce((sum, service) => sum + service.cost_per_unit, 0),
        payment_method: paymentMethod,
        card_fee_pct: null,
        card_fee_value: totalFees > 0 ? totalFees : null,
        net_value: immediateNet,
        notes: persistedNotes || null,
        payment_entries: hasPayment ? computed.map(({ payment, clientPays, feePct, feeValue, netAmount }) => ({
          method: payment.method,
          amount: clientPays,
          card_brand: payment.method === 'cartao_credito' || payment.method === 'cartao_debito' ? payment.cardBrand : null,
          installments: payment.method === 'cartao_credito' ? payment.installments : 1,
          fee_pct: feePct > 0 ? feePct : null,
          fee_value: feeValue > 0 ? feeValue : null,
          net_amount: netAmount,
          absorve_taxa: payment.absorveTaxa,
          scheduled_date: paymentTiming === 'later' ? payment.scheduledDate : null,
          is_immediate: paymentTiming === 'today',
        })) : [],
        coverage_entries: services.flatMap(service => coverageByService[service.id] ? [{ service_id: service.id, package_item_id: coverageByService[service.id]!, quantity: 1 }] : []),
        material_entries: materials.map(item => ({ material_id: item.material_id, quantity: item.quantity })),
        item_values: services.map(service => ({
          service_id: service.id,
          qty: 1,
          final_price: coverageByService[service.id]
            ? service.price
            : courtesyByService[service.id]
              ? 0
              : Number(finalPriceByService[service.id] ?? service.price),
        })),
      });
      if (injectablePoints.length > 0) await saveInjectables(patient.id, injectablePoints, procedure.id);
      try { await draft.remove(); } catch (error) { console.warn('[attendance-draft:cleanup]', error); }
      setDone(true);
    } catch (error) {
      console.error('[treatment-attendance-v2]', error);
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
      <p className="page-sub">{patient?.name} · {new Date(`${performedDate}T12:00:00`).toLocaleDateString('pt-BR')}</p>
      {covered.length > 0 && <div style={{ width: '100%', maxWidth: 520, padding: 13, border: '1px solid #bbf7d0', borderRadius: 11, background: '#f0fdf4', color: '#166534', display: 'grid', gap: 5 }}>{covered.map(label => <strong key={label} style={{ fontSize: '.8rem' }}>{label}</strong>)}</div>}
      {hasPayment && paymentTiming === 'later' ? <div style={{ padding: 12, borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }}><strong style={{ display: 'block' }}>Pagamento em A receber</strong><span style={{ fontSize: '.78rem' }}>O atendimento foi concluído sem marcar o valor como recebido.</span></div> : hasPayment ? <p style={{ fontSize: '.8rem', color: 'var(--text-3)' }}>Recebimento registrado junto do atendimento.</p> : <p style={{ fontSize: '.8rem', color: '#166534' }}>Nenhuma nova cobrança foi criada.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}><button type="button" className="btn btn--secondary btn--md" onClick={() => patient ? navigate(`/pacientes/${patient.id}`) : navigate('/pacientes')}>Voltar à paciente</button><button type="button" className="btn-primary" style={{ padding: '12px 24px' }} onClick={reset}>Novo atendimento</button></div>
    </div></div>;
  }

  return <div className="page">
    <div className="page-header"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{step > 0 && <button type="button" className="icon-btn" onClick={goBack} aria-label="Voltar"><ChevronLeft size={21}/></button>}<div><h1 className="page-title">Registrar atendimento</h1>{patient && step > 0 && <p className="page-sub">{patient.name}</p>}</div></div>{patient && step > 0 && <div style={{ display: 'flex', gap: 6 }}><button type="button" className="btn btn--ghost btn--sm" onClick={() => void saveDraftNow()} disabled={draft.saving}><Save size={15}/> {draft.saving ? 'Salvando…' : 'Salvar rascunho'}</button><button type="button" className="icon-btn" onClick={reset} aria-label="Cancelar atendimento"><X size={19}/></button></div>}</div>
    {injectablesOpen && patient && <Suspense fallback={<div className="full-loader">Carregando mapa…</div>}><InjetaveisScreen patientId={patient.id} injectableServices={services.filter(service => service.is_injectable)} onDone={points => { setInjectablePoints(points); setInjectablesDone(true); setInjectablesOpen(false); setStep(2); }} onCancel={() => { setInjectablesDone(false); setInjectablesOpen(false); setStep(1); }} onSkip={() => { setInjectablePoints([]); setInjectablesDone(true); setInjectablesOpen(false); setStep(2); }}/></Suspense>}
    <div style={{ padding: '0 16px 110px' }}>
      <StepBar step={step} hasInjectables={hasInjectables} hasPayment={hasPayment}/>
      {step === 0 && <StepPatient onSelect={selected => { setPatient(selected); setStep(1); }}/>} 
      {step === 1 && <><AttendanceDetails performedDate={performedDate} onPerformedDate={setPerformedDate} notes={notes} onNotes={setNotes}/><TreatmentExecutionStep catalogServices={servicos} loadingServices={loadingServices} selected={services} entitlements={entitlements} loadingEntitlements={loadingEntitlements} coverageByService={coverageByService} onTreatmentToggle={toggleTreatmentSession} onExtraToggle={toggleExtra}/><BillingAdjustments services={services} coverageByService={coverageByService} finalPriceByService={finalPriceByService} courtesyByService={courtesyByService} onPrice={(serviceId, value) => { setFinalPriceByService(current => ({ ...current, [serviceId]: value })); setCourtesyByService(current => ({ ...current, [serviceId]: false })); }} onCourtesy={(service, value) => { setCourtesyByService(current => ({ ...current, [service.id]: value })); if (!value) setFinalPriceByService(current => ({ ...current, [service.id]: current[service.id] ?? service.price })); }}/></>}
      {step === 2 && <div><h2 style={{ fontSize: '1.12rem', marginBottom: 5 }}>Materiais utilizados</h2><p className="page-sub" style={{ marginBottom: 14 }}>Selecione apenas o que foi efetivamente consumido neste atendimento.</p><MaterialsStep selected={materials} onChange={setMaterials}/></div>}
      {step === 3 && hasPayment && <>{machineError && <div className="empty-state" style={{ marginBottom: 12 }}>{machineError}</div>}<PaymentStep amountDue={amountDue} entries={payments} onEntries={setPayments} rates={machineConfig.rates} timing={paymentTiming} onTiming={setPaymentTiming}/></>}
      {step === 4 && patient && <ConfirmStep patient={patient} services={services} materials={materials} entries={payments} rates={machineConfig.rates} entitlements={entitlements} coverageByService={coverageByService} finalPriceByService={finalPriceByService} courtesyByService={courtesyByService} amountDue={amountDue} paymentTiming={paymentTiming} performedDate={performedDate} notes={notes} saving={saving} onConfirm={() => void confirm()}/>} 
      {step < 4 && <button type="button" className="btn-primary" style={{ position: 'fixed', zIndex: 20, bottom: 'calc(var(--tab-h) + 16px)', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 32px)', maxWidth: 640, minHeight: 52, padding: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, opacity: canContinue ? 1 : .45, pointerEvents: canContinue ? 'auto' : 'none' }} disabled={!canContinue} onClick={handleContinue}>Continuar <ChevronRight size={18}/></button>}
    </div>
  </div>;
}
