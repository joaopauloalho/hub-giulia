import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Search, Check, ChevronRight, ChevronLeft, Loader2, X } from 'lucide-react';
import { usePacientes } from '../../hooks/usePacientes';
import { useServicos } from '../../hooks/useServicos';
import { useProcedures } from '../../hooks/useProcedures';
import { useMaquininhaConfig } from '../../hooks/useMaquininhaConfig';
import type { Patient, Service, PaymentMethod, MaquininhaConfig } from '../../types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Cartão Crédito',
  cartao_debito: 'Cartão Débito',
  pix: 'PIX',
  pix_parcelado: 'PIX Parcelado',
};

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepBar({ step }: { step: number }) {
  const steps = ['Paciente', 'Serviços', 'Pagamento', 'Confirmar'];
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
      {steps.map((label, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: '100%', height: 4, borderRadius: 2,
            background: i <= step ? 'var(--primary)' : 'var(--border)',
            transition: 'background 0.2s',
          }} />
          <span style={{
            fontSize: '0.68rem',
            color: i === step ? 'var(--primary)' : 'var(--text-3)',
            fontWeight: i === step ? 600 : 400,
          }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Paciente ─────────────────────────────────────────────────────────
function StepPaciente({ onSelect }: { onSelect: (p: Patient) => void }) {
  const { pacientes, loading } = usePacientes();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return pacientes.filter(p =>
      p.name.toLowerCase().includes(lq) ||
      (p.phone ?? '').includes(lq)
    );
  }, [pacientes, q]);

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Selecione a paciente</h2>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input
          className="input"
          style={{ paddingLeft: 36 }}
          placeholder="Nome ou telefone…"
          value={q}
          onChange={e => setQ(e.target.value)}
          autoFocus
        />
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}><Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} /></div>
      ) : filtered.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-3)', padding: 32 }}>Nenhuma paciente encontrada.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(p => (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 16px', background: 'var(--bg-2)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                cursor: 'pointer', textAlign: 'left', width: '100%',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                {p.phone && <div style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>{p.phone}</div>}
              </div>
              <ChevronRight size={18} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Serviços ─────────────────────────────────────────────────────────
function StepServicos({
  selected,
  onToggle,
}: {
  selected: Service[];
  onToggle: (s: Service) => void;
}) {
  const { servicos, loading } = useServicos();
  const ativos = servicos.filter(s => s.active);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return ativos.filter(s => s.name.toLowerCase().includes(lq));
  }, [ativos, q]);

  const isSelected = (s: Service) => selected.some(x => x.id === s.id);

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Selecione os serviços</h2>
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
        <input
          className="input"
          style={{ paddingLeft: 36 }}
          placeholder="Buscar serviço…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      {selected.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fdf2f8', borderRadius: 8, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--primary)', fontWeight: 600 }}>
            {selected.length} selecionado{selected.length > 1 ? 's' : ''} · R$ {selected.reduce((s, x) => s + x.price, 0).toFixed(2)}
          </span>
        </div>
      )}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}><Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(s => {
            const sel = isSelected(s);
            return (
              <button
                key={s.id}
                onClick={() => onToggle(s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px',
                  background: sel ? '#fdf2f8' : 'var(--bg-2)',
                  border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer', textAlign: 'left', width: '100%',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: sel ? 'var(--primary)' : 'transparent',
                  border: `2px solid ${sel ? 'var(--primary)' : 'var(--border-2)'}`,
                }}>
                  {sel && <Check size={13} color="white" strokeWidth={3} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{s.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>{s.type}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--primary)' }}>R$ {s.price.toFixed(2)}</div>
                  {s.cost_per_unit > 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-3)' }}>custo {s.cost_per_unit.toFixed(2)}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Pagamento ────────────────────────────────────────────────────────
function StepPagamento({
  services,
  paymentMethod,
  setPaymentMethod,
  installments,
  setInstallments,
  maq,
}: {
  services: Service[];
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  installments: number;
  setInstallments: (n: number) => void;
  maq: MaquininhaConfig;
}) {
  const totalCobrado = services.reduce((s, x) => s + x.price, 0);
  const totalCusto = services.reduce((s, x) => s + x.cost_per_unit, 0);

  let feePct = 0;
  let feeValue = 0;
  if (paymentMethod === 'cartao_credito') { feePct = maq.credito_pct; feeValue = totalCobrado * feePct / 100; }
  if (paymentMethod === 'cartao_debito')  { feePct = maq.debito_pct;  feeValue = totalCobrado * feePct / 100; }
  const lucro = totalCobrado - totalCusto - feeValue;

  const methods: PaymentMethod[] = ['dinheiro', 'pix', 'pix_parcelado', 'cartao_credito', 'cartao_debito'];

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 16 }}>Forma de pagamento</h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 8, marginBottom: 24 }}>
        {[
          { label: 'Cobrado', value: totalCobrado, color: 'var(--text)' },
          { label: 'Custo', value: totalCusto, color: 'var(--red)' },
          { label: 'Lucro est.', value: lucro, color: lucro >= 0 ? 'var(--green)' : 'var(--red)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            padding: '12px 10px', background: 'var(--bg-2)',
            borderRadius: 10, border: '1px solid var(--border)', textAlign: 'center',
          }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontWeight: 700, color, fontSize: '1rem' }}>R$ {value.toFixed(2)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {methods.map(m => (
          <button
            key={m}
            onClick={() => setPaymentMethod(m)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '14px 16px',
              background: paymentMethod === m ? '#fdf2f8' : 'var(--bg-2)',
              border: `1.5px solid ${paymentMethod === m ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left', width: '100%',
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
              border: `2px solid ${paymentMethod === m ? 'var(--primary)' : 'var(--border-2)'}`,
              background: paymentMethod === m ? 'var(--primary)' : 'transparent',
            }} />
            <span style={{ fontWeight: 500, color: 'var(--text)' }}>{PAYMENT_LABELS[m]}</span>
            {(m === 'cartao_credito' || m === 'cartao_debito') && (
              <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-3)' }}>
                {m === 'cartao_credito' ? maq.credito_pct : maq.debito_pct}% taxa
              </span>
            )}
          </button>
        ))}
      </div>

      {feeValue > 0 && (
        <div style={{
          padding: '10px 14px', background: '#fff7ed',
          border: '1px solid #fed7aa', borderRadius: 8,
          fontSize: '0.82rem', color: '#b45309', marginBottom: 16,
        }}>
          Taxa maquininha ({feePct}%): −R$ {feeValue.toFixed(2)}
        </div>
      )}

      {paymentMethod === 'pix_parcelado' && (
        <div style={{ marginTop: 4 }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', marginBottom: 8, display: 'block' }}>
            Número de parcelas
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[2,3,4,5,6,8,10,12].map(n => (
              <button
                key={n}
                onClick={() => setInstallments(n)}
                style={{
                  padding: '8px 16px',
                  background: installments === n ? 'var(--primary)' : 'var(--bg-2)',
                  color: installments === n ? 'white' : 'var(--text)',
                  border: `1.5px solid ${installments === n ? 'var(--primary)' : 'var(--border)'}`,
                  borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem',
                }}
              >{n}x</button>
            ))}
          </div>
          {installments >= 2 && (
            <p style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-3)' }}>
              {installments}x de R$ {(totalCobrado / installments).toFixed(2)} · 1ª parcela em 30 dias
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Confirmar ────────────────────────────────────────────────────────
function StepConfirmar({
  patient,
  services,
  paymentMethod,
  installments,
  saving,
  onConfirm,
  maq,
}: {
  patient: Patient;
  services: Service[];
  paymentMethod: PaymentMethod;
  installments: number;
  saving: boolean;
  onConfirm: () => void;
  maq: MaquininhaConfig;
}) {
  const totalCobrado = services.reduce((s, x) => s + x.price, 0);
  const totalCusto = services.reduce((s, x) => s + x.cost_per_unit, 0);

  let feePct = 0;
  let feeValue = 0;
  if (paymentMethod === 'cartao_credito') { feePct = maq.credito_pct; feeValue = totalCobrado * feePct / 100; }
  if (paymentMethod === 'cartao_debito')  { feePct = maq.debito_pct;  feeValue = totalCobrado * feePct / 100; }
  const netValue = totalCobrado - feeValue;
  const lucro = netValue - totalCusto;

  type RowItem = { label: string; value: string; bold: boolean; color?: string };
  const rows: RowItem[] = [
    { label: 'Total cobrado', value: `R$ ${totalCobrado.toFixed(2)}`, bold: false },
    ...(feeValue > 0 ? [{ label: `Taxa (${feePct}%)`, value: `−R$ ${feeValue.toFixed(2)}`, bold: false }] : []),
    { label: 'Custo', value: `−R$ ${totalCusto.toFixed(2)}`, bold: false },
    { label: 'Lucro estimado', value: `R$ ${lucro.toFixed(2)}`, bold: true, color: lucro >= 0 ? 'var(--green)' : 'var(--red)' },
  ];

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 16 }}>Confirmar atendimento</h2>

      <div style={{ background: 'var(--bg-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 2 }}>Paciente</div>
          <div style={{ fontWeight: 600 }}>{patient.name}</div>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 6 }}>Serviços</div>
          {services.map(s => (
            <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: '0.9rem' }}>{s.name}</span>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>R$ {s.price.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 2 }}>Pagamento</div>
          <div style={{ fontWeight: 600 }}>
            {PAYMENT_LABELS[paymentMethod]}
            {paymentMethod === 'pix_parcelado' && ` · ${installments}x`}
          </div>
        </div>

        <div style={{ padding: '12px 16px' }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>{row.label}</span>
              <span style={{ fontWeight: row.bold ? 700 : 500, color: row.color ?? 'var(--text)', fontSize: '0.85rem' }}>
                {row.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginBottom: 16, textAlign: 'center' }}>
        {format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
      </div>

      <button
        className="btn-primary"
        style={{ width: '100%', padding: '16px', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        onClick={onConfirm}
        disabled={saving}
      >
        {saving ? <Loader2 size={20} className="spin" /> : <Check size={20} />}
        {saving ? 'Salvando…' : 'Confirmar Atendimento'}
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function RegistrarPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { create } = useProcedures();
  const { pacientes, loading: loadingPacientes } = usePacientes();
  const { servicos, loading: loadingServicos } = useServicos();
  const { config: maqConfig, loading: loadingMaq, error: maqError } = useMaquininhaConfig();
  const [step, setStep] = useState(0);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [appointmentId, setAppointmentId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('dinheiro');
  const [installments, setInstallments] = useState(2);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const routeState = (location.state ?? {}) as {
    patient?: Patient;
    patientId?: string;
    appointmentId?: string;
    serviceId?: string | null;
  };

  useEffect(() => {
    const requestedPatient = routeState.patient;
    const patientId = searchParams.get('patient_id') ?? routeState.patientId ?? requestedPatient?.id;
    const nextAppointmentId = searchParams.get('appointment_id') ?? routeState.appointmentId ?? null;
    const serviceId = searchParams.get('service_id') ?? routeState.serviceId ?? null;

    if (!patient && requestedPatient) {
      setPatient(requestedPatient);
      setStep(1);
    } else if (!patient && patientId && !loadingPacientes) {
      const foundPatient = pacientes.find(item => item.id === patientId);
      if (foundPatient) {
        setPatient(foundPatient);
        setStep(1);
      }
    }

    if (nextAppointmentId) {
      setAppointmentId(nextAppointmentId);
    }

    if (serviceId && !loadingServicos && services.length === 0) {
      const foundService = servicos.find(item => item.id === serviceId);
      if (foundService) setServices([foundService]);
    }
  }, [loadingPacientes, loadingServicos, pacientes, patient, routeState.appointmentId, routeState.patient, routeState.patientId, routeState.serviceId, searchParams, services.length, servicos]);

  const toggleService = (s: Service) => {
    setServices(prev =>
      prev.some(x => x.id === s.id) ? prev.filter(x => x.id !== s.id) : [...prev, s]
    );
  };

  const reset = () => {
    setStep(0);
    setPatient(null);
    setServices([]);
    setAppointmentId(null);
    setPaymentMethod('dinheiro');
    setInstallments(2);
    setDone(false);
  };

  const confirm = async () => {
    if (!patient || services.length === 0) return;
    setSaving(true);
    try {
      const totalCobrado = services.reduce((s, x) => s + x.price, 0);
      const totalCusto = services.reduce((s, x) => s + x.cost_per_unit, 0);

      let feePct: number | null = null;
      let feeValue: number | null = null;
      if (paymentMethod === 'cartao_credito') { feePct = maqConfig.credito_pct; feeValue = totalCobrado * feePct / 100; }
      if (paymentMethod === 'cartao_debito')  { feePct = maqConfig.debito_pct;  feeValue = totalCobrado * feePct / 100; }
      const netValue = totalCobrado - (feeValue ?? 0);

      await create({
        patient_id: patient.id,
        appointment_id: appointmentId,
        services_ids: services.map(s => s.id),
        total_value: totalCobrado,
        total_cost: totalCusto,
        payment_method: paymentMethod,
        card_fee_pct: feePct,
        card_fee_value: feeValue,
        net_value: netValue,
        pix_installments_count: paymentMethod === 'pix_parcelado' ? installments : undefined,
      });

      setDone(true);
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <div className="page">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 20, padding: 32 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Check size={36} color="var(--green)" strokeWidth={2.5} />
          </div>
          <h2 style={{ fontWeight: 700, fontSize: '1.3rem', color: 'var(--text)' }}>Atendimento registrado!</h2>
          <p style={{ color: 'var(--text-3)', textAlign: 'center' }}>
            {patient?.name} · {services.map(s => s.name).join(', ')}
          </p>
          <button className="btn-primary" style={{ padding: '12px 32px', marginTop: 8 }} onClick={reset}>
            Novo Registro
          </button>
        </div>
      </div>
    );
  }

  const canAdvance = () => {
    if (step === 0) return !!patient;
    if (step === 1) return services.length > 0;
    if (step === 2) return !loadingMaq && !maqError && (paymentMethod !== 'pix_parcelado' || installments >= 2);
    return true;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {step > 0 && (
            <button
              onClick={() => setStep(s => s - 1)}
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--primary)' }}
            >
              <ChevronLeft size={24} />
            </button>
          )}
          <div>
            <h1 className="page-title">Registrar</h1>
            {patient && step > 0 && (
              <p className="page-sub">{patient.name}</p>
            )}
          </div>
        </div>
        {patient && step > 0 && (
          <button
            onClick={reset}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--text-3)' }}
            title="Cancelar"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <div style={{ padding: '0 16px 100px' }}>
        <StepBar step={step} />

        {step === 0 && (
          <StepPaciente onSelect={p => { setPatient(p); setStep(1); }} />
        )}
        {step === 1 && (
          <StepServicos selected={services} onToggle={toggleService} />
        )}
        {step === 2 && (
          <>
            {maqError && (
              <div className="empty-state" style={{ padding: '16px 0' }}>
                <p>{maqError}</p>
              </div>
            )}
            <StepPagamento
              services={services}
              paymentMethod={paymentMethod}
              setPaymentMethod={m => { setPaymentMethod(m); }}
              installments={installments}
              setInstallments={setInstallments}
              maq={maqConfig}
            />
          </>
        )}
        {step === 3 && patient && (
          <StepConfirmar
            patient={patient}
            services={services}
            paymentMethod={paymentMethod}
            installments={installments}
            saving={saving}
            onConfirm={confirm}
            maq={maqConfig}
          />
        )}

        {step < 3 && (
          <button
            className="btn-primary"
            style={{
              position: 'fixed', bottom: 'calc(var(--tab-h) + 16px)', left: 16, right: 16,
              padding: '16px', fontSize: '1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: canAdvance() ? 1 : 0.45, pointerEvents: canAdvance() ? 'auto' : 'none',
            }}
            onClick={() => setStep(s => s + 1)}
            disabled={!canAdvance()}
          >
            Continuar <ChevronRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
