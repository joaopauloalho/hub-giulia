import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Phone, Mail, Instagram, PenLine, ClipboardPlus, Clock } from 'lucide-react';
import { format } from 'date-fns';
import type { Patient } from '../../types';
import { useServicos } from '../../hooks/useServicos';
import { useRetornos } from '../../hooks/useRetornos';
import { DadosTab } from './tabs/DadosTab';
import { AnamneseTab } from './tabs/AnamneseTab';
import { FotosTab } from './tabs/FotosTab';
import { HistoricoTab } from './tabs/HistoricoTab';
import { InjetaveisTab } from './tabs/InjetaveisTab';
import { ContratosTab } from './tabs/ContratosTab';
import { NotasTab } from './tabs/NotasTab';
import { useToast } from '../../hooks/useToast';
const SignatureScreen = lazy(() => import('./SignatureScreen').then(module => ({ default: module.SignatureScreen })));

interface Props {
  patient: Patient;
  sourceAppointmentId?: string | null;
  onClose: () => void;
  onUpdate: (data: Partial<Patient>) => Promise<void>;
  onDelete: () => Promise<void>;
}

const TABS = ['Dados', 'Anamnese', 'Fotos', 'Histórico', 'Notas', 'Injetáveis', 'Contratos'] as const;
type Tab = typeof TABS[number];

const initials = (name: string) =>
  name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

const RETORNO_BANNER: Record<string, { bg: string; border: string; color: string }> = {
  overdue:   { bg: '#fff5f5', border: '#fecaca', color: '#dc2626' },
  in_window: { bg: '#f0fdf4', border: '#bbf7d0', color: '#16a34a' },
  upcoming:  { bg: '#fffbf0', border: '#fde68a', color: '#d97706' },
};

export function PacienteView({ patient, sourceAppointmentId, onClose, onUpdate, onDelete }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('Dados');
  const [showSignature, setShowSignature] = useState(false);
  const { confirm } = useToast();

  const { servicos } = useServicos();
  const { retornos } = useRetornos(servicos);
  const retorno = retornos.find(r => r.patientId === patient.id);

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Excluir ficha',
      message: `Excluir a ficha de ${patient.name}? Esta acao nao pode ser desfeita.`,
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    await onDelete();
  };

  const handleRegisterProcedure = () => {
    const query = new URLSearchParams({ patient_id: patient.id });
    if (sourceAppointmentId) query.set('appointment_id', sourceAppointmentId);

    navigate(`/registrar?${query.toString()}`, {
      state: {
        patient,
        patientId: patient.id,
        appointmentId: sourceAppointmentId,
      },
    });
  };

  if (showSignature) {
    return (
      <Suspense fallback={<div className="full-loader">Carregando assinatura...</div>}>
        <SignatureScreen
          patient={patient}
          onClose={() => setShowSignature(false)}
          onDone={() => { setShowSignature(false); setTab('Contratos'); }}
        />
      </Suspense>
    );
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="paciente-view-title" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="drawer-header">
          <button className="drawer-back" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
          <div className="avatar">{initials(patient.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-title" id="paciente-view-title">{patient.name}</div>
            <div className="drawer-sub" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 2 }}>
              {patient.phone && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Phone size={11} />{patient.phone}
                </span>
              )}
              {patient.email && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Mail size={11} />{patient.email}
                </span>
              )}
              {patient.instagram && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Instagram size={11} />{patient.instagram}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div style={{
          display: 'flex',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-2)',
        }}>
          <button
            className="btn btn--secondary btn--sm"
            style={{ flex: 1 }}
            onClick={handleRegisterProcedure}
          >
            <ClipboardPlus size={15} /> Registrar atendimento
          </button>
          <button
            className="btn btn--secondary btn--sm"
            style={{ flex: 1 }}
            onClick={() => setShowSignature(true)}
          >
            <PenLine size={15} /> Assinar contrato
          </button>
          <button
            className="btn btn--ghost btn--sm"
            style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
            onClick={handleDelete}
          >
            Excluir
          </button>
        </div>

        {/* Return banner */}
        {retorno && RETORNO_BANNER[retorno.status] && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderBottom: `1px solid ${RETORNO_BANNER[retorno.status].border}`,
            background: RETORNO_BANNER[retorno.status].bg,
          }}>
            <Clock size={14} style={{ color: RETORNO_BANNER[retorno.status].color, flexShrink: 0 }} />
            <span style={{ fontSize: '0.82rem', color: RETORNO_BANNER[retorno.status].color }}>
              {retorno.daysLabel}
              {retorno.windowStart && retorno.windowEnd && (
                <> · retornar {format(retorno.windowStart, 'dd/MM')} – {format(retorno.windowEnd, 'dd/MM')}</>
              )}
            </span>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="sub-tabs">
          {TABS.map(t => (
            <button
              key={t}
              className={`sub-tab${tab === t ? ' sub-tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="drawer-body">
          {tab === 'Dados'     && <DadosTab patient={patient} onUpdate={onUpdate} />}
          {tab === 'Anamnese'  && <AnamneseTab patientId={patient.id} />}
          {tab === 'Fotos'     && <FotosTab patientId={patient.id} />}
          {tab === 'Histórico'  && <HistoricoTab patientId={patient.id} />}
          {tab === 'Notas' && <NotasTab patientId={patient.id} />}
          {tab === 'Injetáveis' && <InjetaveisTab patientId={patient.id} patientName={patient.name} />}
          {tab === 'Contratos' && (
            <ContratosTab
              patientId={patient.id}
              onSignNew={() => setShowSignature(true)}
            />
          )}
        </div>

      </aside>
    </div>
  );
}
