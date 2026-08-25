import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Search, Check, ChevronRight, ChevronLeft, Loader2, X, Plus, Trash2, WalletCards } from 'lucide-react';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { useProcedures } from '../../hooks/useProcedures';
import { useInjetaveis } from '../../hooks/useInjetaveis';
import { useMaquininhaConfig, getFeePct } from '../../hooks/useMaquininhaConfig';
import { usePatientEntitlements } from '../../hooks/usePackages';
import { useToast } from '../../hooks/useToast';
import { clearAttendanceInjectableDraft, clearAttendanceInjectablePoints } from '../../lib/attendanceRuntime';
import type { Patient, Service, PaymentMethod, MaquininhaRates, PaymentEntryUI, CardBrand, SimplePaymentMethod, InjectablePoint } from '../../types';
import type { PatientEntitlement } from '../../types/packages';
import { MaterialsStep, type SelectedAttendanceMaterial } from './MaterialsStep';
const InjetaveisScreen = lazy(() => import('./InjetaveisScreen').then(m => ({ default: m.InjetaveisScreen })));
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const METHOD_LABELS: Record<SimplePaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_credito: 'Crédito',
  cartao_debito: 'Débito',
};

const TODAY = format(new Date(), 'yyyy-MM-dd');

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
  const feeValue = clientPays * feePct / 100;
  return { feePct, clientPays, feeValue, netAmount };
}

function selectedCoverageValue(services: Service[], coverageByService: Record<string, string | undefined>) {
  return services.reduce((total, service) => total + (coverageByService[service.id] ? service.price : 0), 0);
}

function StepBar({ step, hasInjectables, injetaveisDone }: { step: number; hasInjectables: boolean; injetaveisDone: boolean }) {
  const steps = hasInjectables
    ? ['Paciente', 'Serviços', 'Injetáveis', 'Materiais', 'Pagamento', 'Confirmar']
    : ['Paciente', 'Serviços', 'Materiais', 'Pagamento', 'Confirmar'];
  const visualStep = hasInjectables
    ? (step === 1 && !injetaveisDone ? 1 : step >= 2 ? step + 1 : step)
    : step;

  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
      {steps.map((label, i) => (
        <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <div style={{ width: '100%', height: 4, borderRadius: 2, background: i <= visualStep ? 'var(--primary)' : 'var(--border)', transition: 'background 0.2s' }} />
          <span style={{ fontSize: '0.62rem', whiteSpace: 'nowrap', color: i === visualStep ? 'var(--primary)' : 'var(--text-3)', fontWeight: i === visualStep ? 600 : 400 }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

function StepPaciente({ onSelect }: { onSelect: (p: Patient) => void }) {
  const [q, setQ] = useState('');
  const { pacientes, loading, nextPage, hasMore } = usePacientes({ search: q });
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return pacientes.filter(p => p.name.toLowerCase().includes(lq) || (p.phone ?? '').includes(lq));
  }, [pacientes, q]);

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Selecione a paciente</h2>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input className="input" style={{ paddingLeft: 36 }} placeholder="Nome ou telefone…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      </div>
      {loading ? <div style={{ textAlign: 'center', padding: 32 }}><Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} /></div> : filtered.length === 0 ? <p style={{ textAlign: 'center', color: 'var(--text-3)', padding: 32 }}>Nenhuma paciente encontrada.</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(p => <button key={p.id} onClick={() => onSelect(p)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left', width: '100%' }}><div><div style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>{p.phone && <div style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>{p.phone}</div>}</div><ChevronRight size={18} style={{ color: 'var(--text-3)', flexShrink: 0 }} /></button>)}
          {hasMore && <button className="btn btn--secondary btn--md" type="button" onClick={nextPage}>Carregar mais</button>}
        </div>
      )}
    </div>
  );
}

function StepServicos({ selected, onToggle }: { selected: Service[]; onToggle: (s: Service) => void }) {
  const { servicos, loading } = useServicos();
  const ativos = servicos.filter(s => s.active);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => ativos.filter(s => s.name.toLowerCase().includes(q.toLowerCase())), [ativos, q]);
  const isSelected = (s: Service) => selected.some(x => x.id === s.id);

  return <div>
    <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Selecione os serviços</h2>
    <div style={{ position: 'relative', marginBottom: 16 }}><Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} /><input className="input" style={{ paddingLeft: 36 }} placeholder="Buscar serviço…" value={q} onChange={e => setQ(e.target.value)} /></div>
    {selected.length > 0 && <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fdf2f8', borderRadius: 8, border: '1px solid var(--border)' }}><span style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 600 }}>{selected.length} selecionado{selected.length > 1 ? 's' : ''} · R$ {selected.reduce((s, x) => s + x.price, 0).toFixed(2)}</span></div>}
    {loading ? <div style={{ textAlign: 'center', padding: 32 }}><Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} /></div> : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{filtered.map(s => { const sel = isSelected(s); return <button key={s.id} onClick={() => onToggle(s)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: sel ? '#fdf2f8' : 'var(--bg-2)', border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left', width: '100%' }}><div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: sel ? 'var(--primary)' : 'transparent', border: `2px solid ${sel ? 'var(--primary)' : 'var(--border-2)'}` }}>{sel && <Check size={13} color="white" strokeWidth={3} />}</div><div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{s.name}</div><div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{s.type}</div></div><div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700, color: 'var(--primary)' }}>R$ {s.price.toFixed(2)}</div>{s.cost_per_unit > 0 && <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>custo {s.cost_per_unit.toFixed(2)}</div>}</div></button>; })}</div>}
  </div>;
}

function EntryCard({ entry, index, rates, canRemove, onChange, onRemove }: { entry: PaymentEntryUI; index: number; rates: MaquininhaRates; canRemove: boolean; onChange: (e: PaymentEntryUI) => void; onRemove: () => void }) {
  const { feePct, clientPays, feeValue, netAmount } = computeEntry(entry, rates);
  const isCard = entry.method === 'cartao_credito' || entry.method === 'cartao_debito';
  const isCredit = entry.method === 'cartao_credito';
  const isScheduled = entry.scheduledDate > TODAY;
  return <div style={{ background: 'var(--bg-2)', border: `1.5px solid ${isScheduled ? '#fde68a' : 'var(--border)'}`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}><span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Pagamento {index + 1}{isScheduled ? ' 📅' : ''}</span>{canRemove && <button onClick={onRemove} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-3)' }}><Trash2 size={16} /></button>}</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>{(Object.entries(METHOD_LABELS) as [SimplePaymentMethod, string][]).map(([m, label]) => <button key={m} onClick={() => onChange({ ...entry, method: m, installments: 1 })} style={{ padding: '8px 4px', fontSize: '0.72rem', fontWeight: 600, background: entry.method === m ? '#fdf2f8' : 'var(--bg)', border: `1.5px solid ${entry.method === m ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', color: entry.method === m ? 'var(--primary)' : 'var(--text)' }}>{label}</button>)}</div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{feePct > 0 && !entry.absorveTaxa ? 'Valor que quero receber (líquido)' : 'Valor cobrado'}</label><input className="field-input" type="number" min="0" step="0.01" value={entry.baseValue || ''} onChange={e => onChange({ ...entry, baseValue: parseFloat(e.target.value) || 0 })} style={{ width: '100%' }} /></div>
    {isCard && <div style={{ marginBottom: 12 }}><label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Bandeira</label><div style={{ display: 'flex', gap: 8 }}>{(['master_visa', 'elo'] as CardBrand[]).map(b => <button key={b} onClick={() => onChange({ ...entry, cardBrand: b })} style={{ flex: 1, padding: '8px', fontSize: '0.82rem', background: entry.cardBrand === b ? '#fdf2f8' : 'var(--bg)', border: `1.5px solid ${entry.cardBrand === b ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', fontWeight: entry.cardBrand === b ? 600 : 400, color: entry.cardBrand === b ? 'var(--primary)' : 'var(--text)' }}>{b === 'master_visa' ? 'Master / Visa' : 'Elo'}</button>)}</div></div>}
    {isCredit && <div style={{ marginBottom: 12 }}><label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Parcelas</label><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{Array.from({ length: 18 }, (_, i) => i + 1).map(n => { const sel = entry.installments === n; return <button key={n} onClick={() => onChange({ ...entry, installments: n })} style={{ padding: '5px 9px', fontSize: '0.78rem', fontWeight: 600, background: sel ? 'var(--primary)' : 'var(--bg)', border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 7, cursor: 'pointer', color: sel ? 'white' : 'var(--text)' }}>{n}x</button>; })}</div>{entry.installments > 1 && clientPays > 0 && <p style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-3)' }}>{entry.installments}x de R$ {(clientPays / entry.installments).toFixed(2)}</p>}</div>}
    {feePct > 0 && <div style={{ marginBottom: 12 }}><label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>Quem absorve a taxa?</label><div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>{[{ val: true, label: 'Eu absorvo' }, { val: false, label: 'Repassar ao cliente' }].map(({ val, label }) => <button key={String(val)} onClick={() => onChange({ ...entry, absorveTaxa: val })} style={{ flex: 1, padding: '8px', fontSize: '0.78rem', background: entry.absorveTaxa === val ? '#fdf2f8' : 'var(--bg)', border: `1.5px solid ${entry.absorveTaxa === val ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', fontWeight: entry.absorveTaxa === val ? 600 : 400, color: entry.absorveTaxa === val ? 'var(--primary)' : 'var(--text)' }}>{label}</button>)}</div><div style={{ padding: '8px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, fontSize: '0.78rem', color: '#b45309' }}>Cliente paga R$ {clientPays.toFixed(2)} · Taxa {feePct}% = R$ {feeValue.toFixed(2)} · Você recebe R$ {netAmount.toFixed(2)}</div></div>}
    <div><label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>{isScheduled ? 'Data combinada (agendado)' : 'Data do pagamento'}</label><input className="field-input" type="date" value={entry.scheduledDate} onChange={e => onChange({ ...entry, scheduledDate: e.target.value })} style={{ width: '100%' }} /></div>
  </div>;
}

function CoverageOptions({ services, entitlements, coverageByService, onSelectCoverage, loading }: { services: Service[]; entitlements: PatientEntitlement[]; coverageByService: Record<string, string | undefined>; onSelectCoverage: (serviceId: string, packageItemId: string | null) => void; loading: boolean }) {
  const compatible = entitlements.filter(item => item.service_id && item.available_balance >= 1 && item.effective_status === 'active');
  if (!loading && compatible.length === 0) return null;
  return <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12 }}><div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}><WalletCards size={18} style={{ color: 'var(--primary)' }} /><strong style={{ fontSize: '0.92rem' }}>Cobertura por pacote/crédito</strong></div><p style={{ margin: '0 0 14px', fontSize: '0.76rem', color: 'var(--text-3)' }}>O crédito só será consumido ao confirmar este atendimento.</p>{loading ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-3)', fontSize: '0.8rem' }}><Loader2 size={14} className="spin" /> Verificando créditos…</div> : services.map(service => { const options = compatible.filter(item => item.service_id === service.id); if (!options.length) return null; const selectedId = coverageByService[service.id]; return <div key={service.id} style={{ paddingTop: 12, marginTop: 12, borderTop: '1px solid var(--border)' }}><div style={{ fontWeight: 600, fontSize: '0.84rem', marginBottom: 8 }}>{service.name}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><button type="button" onClick={() => onSelectCoverage(service.id, null)} style={{ padding: '9px 11px', borderRadius: 8, cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600, background: !selectedId ? '#fdf2f8' : 'var(--bg)', border: `1.5px solid ${!selectedId ? 'var(--primary)' : 'var(--border)'}`, color: !selectedId ? 'var(--primary)' : 'var(--text)' }}>Cobrar normalmente</button>{options.map(item => { const selected = selectedId === item.package_item_id; return <button key={item.package_item_id} type="button" onClick={() => onSelectCoverage(service.id, item.package_item_id)} style={{ padding: '9px 11px', borderRadius: 8, cursor: 'pointer', fontSize: '0.76rem', textAlign: 'left', background: selected ? '#f0fdf4' : 'var(--bg)', border: `1.5px solid ${selected ? '#22c55e' : 'var(--border)'}`, color: selected ? '#166534' : 'var(--text)' }}><strong>Usar crédito — {item.package_title}</strong><br/><span style={{ opacity: .78 }}>{item.available_balance.toLocaleString('pt-BR')} disponível{item.available_balance === 1 ? '' : 'is'}</span></button>; })}</div></div>; })}</div>;
}

function StepPagamento({ services, entries, setEntries, rates, entitlements, coverageByService, onSelectCoverage, loadingEntitlements }: { services: Service[]; entries: PaymentEntryUI[]; setEntries: (e: PaymentEntryUI[]) => void; rates: MaquininhaRates; entitlements: PatientEntitlement[]; coverageByService: Record<string, string | undefined>; onSelectCoverage: (serviceId: string, packageItemId: string | null) => void; loadingEntitlements: boolean }) {
  const total = services.reduce((s, x) => s + x.price, 0);
  const covered = selectedCoverageValue(services, coverageByService);
  const amountDue = Math.max(0, +(total - covered).toFixed(2));
  const computed = entries.map(e => computeEntry(e, rates));
  const sumBase = entries.reduce((s, e) => s + e.baseValue, 0);
  const remaining = +(amountDue - sumBase).toFixed(2);
  const balanced = Math.abs(remaining) < 0.01;
  const update = (idx: number, e: PaymentEntryUI) => setEntries(entries.map((x, i) => i === idx ? e : x));
  const remove = (idx: number) => setEntries(entries.filter((_, i) => i !== idx));
  const addEntry = () => setEntries([...entries, mkEntry(remaining > 0 ? remaining : 0)]);
  return <div><h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 16 }}>Cobertura e pagamento</h2><CoverageOptions services={services} entitlements={entitlements} coverageByService={coverageByService} onSelectCoverage={onSelectCoverage} loading={loadingEntitlements}/><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>{[{ label: 'Valor serviços', value: total, color: 'var(--text)' }, { label: 'Coberto', value: covered, color: covered > 0 ? 'var(--green)' : 'var(--text-3)' }, { label: 'A cobrar agora', value: amountDue, color: 'var(--primary)' }].map(({ label, value, color }) => <div key={label} style={{ padding: '10px 8px', background: 'var(--bg-2)', borderRadius: 10, border: '1px solid var(--border)', textAlign: 'center' }}><div style={{ fontSize: '0.68rem', color: 'var(--text-3)', marginBottom: 3 }}>{label}</div><div style={{ fontWeight: 700, color, fontSize: '0.92rem' }}>R$ {value.toFixed(2)}</div></div>)}</div>{amountDue <= .01 ? <div style={{ padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#166534', fontSize: '0.84rem', fontWeight: 600 }}>✓ Coberto por pacote. Nenhum pagamento é devido agora.</div> : <><h3 style={{ fontSize: '0.88rem', margin: '0 0 10px' }}>Pagamento do valor restante</h3>{entries.map((e, i) => <EntryCard key={e.tempId} entry={e} index={i} rates={rates} canRemove={entries.length > 1} onChange={updated => update(i, updated)} onRemove={() => remove(i)}/>) }<div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}><button onClick={addEntry} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: 'var(--bg-2)', border: '1.5px dashed var(--border)', borderRadius: 10, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}><Plus size={16}/> Adicionar pagamento</button><div style={{ flex: 1, padding: '10px 12px', borderRadius: 10, textAlign: 'center', background: balanced ? '#f0fdf4' : '#fffbf0', border: `1px solid ${balanced ? '#bbf7d0' : '#fde68a'}`, fontSize: '0.78rem', color: balanced ? 'var(--green)' : '#b45309', fontWeight: 600 }}>{balanced ? '✓ Alocado' : `Falta R$ ${remaining.toFixed(2)}`}</div></div></>}</div>;
}

function StepConfirmar({ patient, services, materials, entries, rates, saving, onConfirm, entitlements, coverageByService }: { patient: Patient; services: Service[]; materials: SelectedAttendanceMaterial[]; entries: PaymentEntryUI[]; rates: MaquininhaRates; saving: boolean; onConfirm: () => void; entitlements: PatientEntitlement[]; coverageByService: Record<string, string | undefined> }) {
  const valorServicos = services.reduce((s, x) => s + x.price, 0);
  const covered = selectedCoverageValue(services, coverageByService);
  const amountDue = Math.max(0, +(valorServicos - covered).toFixed(2));
  const baseCost = services.reduce((s, x) => s + x.cost_per_unit, 0);
  const materialsCost = materials.reduce((sum, item) => sum + item.quantity * item.material.unit_cost, 0);
  const clinicalCost = baseCost + materialsCost;
  const computed = entries.map(e => ({ entry: e, ...computeEntry(e, rates) }));
  const totalNet = computed.reduce((s, c) => s + c.netAmount, 0);
  const totalFee = computed.reduce((s, c) => s + c.feeValue, 0);
  const directContribution = totalNet - clinicalCost;
  const entitlementById = new Map(entitlements.map(item => [item.package_item_id, item]));
  return <div><h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 16 }}>Confirmar atendimento</h2><div style={{ background: 'var(--bg-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 20 }}>
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 2 }}>Paciente</div><div style={{ fontWeight: 600 }}>{patient.name}</div></div>
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 6 }}>Serviços e cobertura</div>{services.map(s => { const coverageId = coverageByService[s.id]; const entitlement = coverageId ? entitlementById.get(coverageId) : undefined; return <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}><div><span style={{ fontSize: '0.9rem' }}>{s.name}</span>{entitlement && <div style={{ fontSize: '0.72rem', color: '#166534', fontWeight: 600 }}>Coberto por {entitlement.package_title} · 1 crédito</div>}</div><span style={{ fontWeight: 600, fontSize: '0.9rem' }}>R$ {s.price.toFixed(2)}</span></div>; })}</div>
    {materials.length > 0 && <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 6 }}>Materiais utilizados</div>{materials.map(item => <div key={item.material_id} style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:'0.84rem',marginBottom:5}}><span>{item.quantity.toLocaleString('pt-BR',{maximumFractionDigits:3})}x {item.material.name}</span><span>R$ {(item.quantity*item.material.unit_cost).toFixed(2)}</span></div>)}</div>}
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 8 }}>Pagamentos agora</div>{computed.length === 0 ? <div style={{ fontSize: '0.84rem', color: '#166534', fontWeight: 600 }}>Nenhum — atendimento totalmente coberto por pacote.</div> : computed.map(({ entry, clientPays, feePct, feeValue, netAmount }) => <div key={entry.tempId} style={{display:'flex',justifyContent:'space-between',gap:12,marginBottom:8}}><div><strong style={{fontSize:'.86rem'}}>{METHOD_LABELS[entry.method]}{entry.method==='cartao_credito'&&` ${entry.installments}x`}</strong>{feePct>0&&<div style={{fontSize:'.72rem',color:'var(--text-3)'}}>Taxa {feePct}% = R$ {feeValue.toFixed(2)}</div>}{entry.scheduledDate>TODAY&&<div style={{fontSize:'.72rem',color:'#b45309'}}>📅 {entry.scheduledDate.split('-').reverse().join('/')}</div>}</div><div style={{textAlign:'right',fontSize:'.86rem',fontWeight:600}}>R$ {clientPays.toFixed(2)}{feePct>0&&<div style={{fontSize:'.72rem',fontWeight:400,color:'var(--text-3)'}}>→ R$ {netAmount.toFixed(2)}</div>}</div></div>)}</div>
    <div style={{ padding: '12px 16px' }}>{[
      { label: 'Valor dos serviços', value: `R$ ${valorServicos.toFixed(2)}`, bold: false },
      ...(covered > 0 ? [{ label: 'Coberto por pacotes', value: `−R$ ${covered.toFixed(2)}`, bold: false, color: '#166534' }] : []),
      { label: 'A cobrar agora', value: `R$ ${amountDue.toFixed(2)}`, bold: true, color: 'var(--primary)' },
      ...(totalFee > 0 ? [{ label: 'Taxas', value: `−R$ ${totalFee.toFixed(2)}`, bold: false }] : []),
      { label: 'Custo dos procedimentos', value: `−R$ ${baseCost.toFixed(2)}`, bold: false },
      { label: 'Materiais utilizados', value: `−R$ ${materialsCost.toFixed(2)}`, bold: false },
      { label: 'Custo clínico total', value: `−R$ ${clinicalCost.toFixed(2)}`, bold: true },
      ...(covered === 0 ? [{ label: 'Contribuição direta estimada', value: `R$ ${directContribution.toFixed(2)}`, bold: true, color: directContribution >= 0 ? 'var(--green)' : 'var(--red)' }] : [{ label: 'Líquido recebido agora', value: `R$ ${totalNet.toFixed(2)}`, bold: false }]),
    ].map((row, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>{row.label}</span><span style={{ fontWeight: row.bold ? 700 : 500, color: (row as { color?: string }).color ?? 'var(--text)', fontSize: '0.85rem' }}>{row.value}</span></div>)}</div>
  </div><div style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginBottom: 16, textAlign: 'center' }}>{format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</div><button className="btn-primary" style={{ width: '100%', padding: '16px', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={onConfirm} disabled={saving}>{saving ? <Loader2 size={20} className="spin" /> : <Check size={20} />}{saving ? 'Salvando…' : 'Confirmar Atendimento'}</button></div>;
}

export function RegistrarPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { create } = useProcedures();
  const { pacientes, loading: loadingPacientes, getById } = usePacientes();
  const { servicos, loading: loadingServicos } = useServicos();
  const { config: maqConfig, loading: loadingMaq, error: maqError } = useMaquininhaConfig();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<SelectedAttendanceMaterial[]>([]);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [paymentEntries, setPaymentEntries] = useState<PaymentEntryUI[]>([]);
  const [coverageByService, setCoverageByService] = useState<Record<string, string | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [injectablePoints, setInjectablePoints] = useState<InjectablePoint[]>([]);
  const [showInjetaveisScreen, setShowInjetaveisScreen] = useState(false);
  const [injetaveisDone, setInjetaveisDone] = useState(false);
  const { save: saveInjetaveis } = useInjetaveis();
  const hasInjectables = services.some(s => s.is_injectable);
  const serviceIds = services.map(service => service.id);
  const { data: entitlements, loading: loadingEntitlements } = usePatientEntitlements(patient?.id, serviceIds);
  const routeState = (location.state ?? {}) as { patient?: Patient; patientId?: string; appointmentId?: string; serviceId?: string | null };

  useEffect(() => {
    const requestedPatient = routeState.patient;
    const patientId = searchParams.get('patient_id') ?? routeState.patientId ?? requestedPatient?.id;
    const nextAppointmentId = searchParams.get('appointment_id') ?? routeState.appointmentId ?? null;
    const serviceId = searchParams.get('service_id') ?? routeState.serviceId ?? null;
    if (!patient && requestedPatient) { setPatient(requestedPatient); setStep(1); }
    else if (!patient && patientId && !loadingPacientes) {
      const found = pacientes.find(item => item.id === patientId);
      if (found) { setPatient(found); setStep(1); }
      else { let active = true; getById(patientId).then(remotePatient => { if (active && remotePatient) { setPatient(remotePatient); setStep(1); } }).catch(() => undefined); return () => { active = false; }; }
    }
    if (nextAppointmentId) setAppointmentId(nextAppointmentId);
    if (serviceId && !loadingServicos && services.length === 0) { const found = servicos.find(item => item.id === serviceId); if (found) setServices([found]); }
  }, [getById, loadingPacientes, loadingServicos, pacientes, patient, routeState.appointmentId, routeState.patient, routeState.patientId, routeState.serviceId, searchParams, services.length, servicos]);

  const totalServices = services.reduce((s, x) => s + x.price, 0);
  const coveredValue = selectedCoverageValue(services, coverageByService);
  const amountDue = Math.max(0, +(totalServices - coveredValue).toFixed(2));

  useEffect(() => { if (step === 3 && paymentEntries.length === 0 && services.length > 0 && amountDue > 0.01) setPaymentEntries([mkEntry(amountDue)]); }, [step, paymentEntries.length, services, amountDue]);
  useEffect(() => { const selected = new Set(services.map(service => service.id)); setCoverageByService(current => Object.fromEntries(Object.entries(current).filter(([serviceId]) => selected.has(serviceId)))); }, [services]);
  useEffect(() => { if (hasInjectables) return; clearAttendanceInjectableDraft(); clearAttendanceInjectablePoints(); setInjectablePoints([]); setInjetaveisDone(false); }, [hasInjectables]);

  const toggleService = (s: Service) => setServices(prev => prev.some(x => x.id === s.id) ? prev.filter(x => x.id !== s.id) : [...prev, s]);
  const selectCoverage = (serviceId: string, packageItemId: string | null) => { const next = { ...coverageByService }; if (packageItemId) next[serviceId] = packageItemId; else delete next[serviceId]; setCoverageByService(next); const nextCovered = selectedCoverageValue(services, next); const nextDue = Math.max(0, +(totalServices - nextCovered).toFixed(2)); setPaymentEntries(nextDue > .01 ? [mkEntry(nextDue)] : []); };

  const reset = () => {
    clearAttendanceInjectableDraft(); clearAttendanceInjectablePoints(); setStep(0); setPatient(null); setServices([]); setSelectedMaterials([]); setAppointmentId(null); setPaymentEntries([]); setCoverageByService({}); setDone(false); setInjectablePoints([]); setShowInjetaveisScreen(false); setInjetaveisDone(false);
  };

  const confirm = async () => {
    if (!patient || services.length === 0 || (amountDue > .01 && paymentEntries.length === 0)) return;
    setSaving(true);
    try {
      const rates = maqConfig.rates;
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const computed = paymentEntries.map(e => ({ e, ...computeEntry(e, rates) }));
      const immediateNetValue = computed.filter(c => c.e.scheduledDate <= todayStr).reduce((s, c) => s + c.netAmount, 0);
      const totalFeeValue = computed.reduce((s, c) => s + c.feeValue, 0);
      const paymentMethod: PaymentMethod = paymentEntries.length === 1 ? paymentEntries[0].method : 'split';
      const payment_entries = computed.map(({ e, clientPays, feePct, feeValue, netAmount }) => ({ method: e.method, amount: clientPays, card_brand: (e.method === 'cartao_credito' || e.method === 'cartao_debito') ? e.cardBrand : null, installments: e.method === 'cartao_credito' ? e.installments : 1, fee_pct: feePct > 0 ? feePct : null, fee_value: feeValue > 0 ? feeValue : null, net_amount: netAmount, absorve_taxa: e.absorveTaxa, scheduled_date: e.scheduledDate !== todayStr ? e.scheduledDate : null, is_immediate: e.scheduledDate <= todayStr }));
      const coverage_entries = services.flatMap(service => { const packageItemId = coverageByService[service.id]; return packageItemId ? [{ service_id: service.id, package_item_id: packageItemId, quantity: 1 }] : []; });
      const procedure = await create({
        patient_id: patient.id,
        appointment_id: appointmentId,
        services_ids: services.map(s => s.id),
        total_value: amountDue,
        total_cost: services.reduce((s, x) => s + x.cost_per_unit, 0),
        payment_method: paymentMethod,
        card_fee_pct: null,
        card_fee_value: totalFeeValue > 0 ? totalFeeValue : null,
        net_value: immediateNetValue,
        payment_entries,
        coverage_entries,
        material_entries: selectedMaterials.map(item => ({ material_id: item.material_id, quantity: item.quantity })),
        item_values: services.map(service => ({ service_id: service.id, qty: 1, final_price: service.price })),
      });
      if (injectablePoints.length > 0) await saveInjetaveis(patient.id, injectablePoints, procedure?.id);
      setDone(true);
    } catch (e) {
      console.error(e);
      const message = e instanceof Error && e.message.includes('MATERIAL_INSUFFICIENT_STOCK') ? 'Estoque insuficiente para um dos materiais selecionados. Revise as quantidades.' : 'Erro ao salvar. Tente novamente.';
      toast.error(message);
    } finally { setSaving(false); }
  };

  if (done) {
    const hasScheduled = paymentEntries.some(e => e.scheduledDate > TODAY);
    const usedCredits = Object.keys(coverageByService).length;
    return <div className="page"><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20, padding: 32 }}><div style={{ width: 72, height: 72, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={36} color="var(--green)" strokeWidth={2.5}/></div><h2 style={{ fontWeight: 700, fontSize: '1.3rem' }}>Atendimento registrado!</h2><p style={{ color: 'var(--text-3)', textAlign: 'center' }}>{patient?.name} · {services.map(s => s.name).join(', ')}</p>{selectedMaterials.length > 0 && <p style={{fontSize:'.85rem',color:'#166534',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'10px 16px'}}>{selectedMaterials.length} tipo{selectedMaterials.length===1?'':'s'} de material baixado{selectedMaterials.length===1?'':'s'} do estoque.</p>}{usedCredits > 0 && <p style={{ fontSize: '0.85rem', color: '#166534' }}>{usedCredits} crédito{usedCredits > 1 ? 's' : ''} consumido{usedCredits > 1 ? 's' : ''}.</p>}{hasScheduled && <p style={{ fontSize: '0.85rem', color: '#b45309' }}>Pagamento(s) agendado(s) adicionados ao Financeiro.</p>}<button className="btn-primary" style={{ padding: '12px 32px', marginTop: 8 }} onClick={reset}>Novo Registro</button></div></div>;
  }

  const sumBase = paymentEntries.reduce((s, e) => s + e.baseValue, 0);
  const balanced = Math.abs(amountDue - sumBase) < .01;
  const canAdvance = () => {
    if (step === 0) return !!patient;
    if (step === 1) return services.length > 0;
    if (step === 3) { if (amountDue <= .01 && paymentEntries.length === 0) return true; return !loadingMaq && !maqError && paymentEntries.length > 0 && balanced; }
    return true;
  };
  const handleContinue = () => { if (step === 1 && hasInjectables && !injetaveisDone) setShowInjetaveisScreen(true); else setStep(s => s + 1); };

  return <div className="page">
    <div className="page-header"><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{step > 0 && <button onClick={() => setStep(s => s - 1)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--primary)' }}><ChevronLeft size={24}/></button>}<div><h1 className="page-title">Registrar</h1>{patient && step > 0 && <p className="page-sub">{patient.name}</p>}</div></div>{patient && step > 0 && <button onClick={reset} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-3)' }} title="Cancelar"><X size={20}/></button>}</div>
    {showInjetaveisScreen && patient && <Suspense fallback={<div className="full-loader">Carregando mapa...</div>}><InjetaveisScreen patientId={patient.id} injectableServices={services.filter(s => s.is_injectable)} onDone={pts => { setInjectablePoints(pts); setInjetaveisDone(true); setShowInjetaveisScreen(false); setStep(2); }} onCancel={() => { setInjetaveisDone(false); setShowInjetaveisScreen(false); setStep(1); }} onSkip={() => { setInjectablePoints([]); setInjetaveisDone(true); setShowInjetaveisScreen(false); setStep(2); }}/></Suspense>}
    <div style={{ padding: '0 16px 100px' }}><StepBar step={step} hasInjectables={hasInjectables} injetaveisDone={injetaveisDone}/>{step === 0 && <StepPaciente onSelect={p => { setPatient(p); setStep(1); }}/>} {step === 1 && <StepServicos selected={services} onToggle={toggleService}/>} {step === 2 && <MaterialsStep selected={selectedMaterials} onChange={setSelectedMaterials}/>} {step === 3 && <>{maqError && amountDue > .01 && <div className="empty-state" style={{ padding: '16px 0' }}><p>{maqError}</p></div>}<StepPagamento services={services} entries={paymentEntries} setEntries={setPaymentEntries} rates={maqConfig.rates} entitlements={entitlements} coverageByService={coverageByService} onSelectCoverage={selectCoverage} loadingEntitlements={loadingEntitlements}/></>} {step === 4 && patient && <StepConfirmar patient={patient} services={services} materials={selectedMaterials} entries={paymentEntries} rates={maqConfig.rates} saving={saving} onConfirm={confirm} entitlements={entitlements} coverageByService={coverageByService}/>} {step < 4 && <button className="btn-primary" style={{ position: 'fixed', bottom: 'calc(var(--tab-h) + 16px)', left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 32px)', maxWidth: 640, padding: '16px', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: canAdvance() ? 1 : .45, pointerEvents: canAdvance() ? 'auto' : 'none' }} onClick={handleContinue} disabled={!canAdvance()}>Continuar <ChevronRight size={18}/></button>}</div>
  </div>;
}
