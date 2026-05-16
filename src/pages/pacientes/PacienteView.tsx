import { useState } from 'react';
import { X, Phone, Mail, Instagram, PenLine } from 'lucide-react';
import type { Patient } from '../../types';
import { DadosTab } from './tabs/DadosTab';
import { AnamneseTab } from './tabs/AnamneseTab';
import { FotosTab } from './tabs/FotosTab';
import { HistoricoTab } from './tabs/HistoricoTab';
import { ContratosTab } from './tabs/ContratosTab';
import { SignatureScreen } from './SignatureScreen';

interface Props {
  patient: Patient;
  onClose: () => void;
  onUpdate: (data: Partial<Patient>) => Promise<void>;
  onDelete: () => Promise<void>;
}

const TABS = ['Dados', 'Anamnese', 'Fotos', 'Histórico', 'Contratos'] as const;
type Tab = typeof TABS[number];

const initials = (name: string) =>
  name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

export function PacienteView({ patient, onClose, onUpdate, onDelete }: Props) {
  const [tab, setTab] = useState<Tab>('Dados');
  const [showSignature, setShowSignature] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Excluir a ficha de ${patient.name}? Esta ação não pode ser desfeita.`)) return;
    await onDelete();
  };

  if (showSignature) {
    return (
      <SignatureScreen
        patient={patient}
        onClose={() => setShowSignature(false)}
        onDone={() => { setShowSignature(false); setTab('Contratos'); }}
      />
    );
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="drawer-header">
          <button className="drawer-back" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
          <div className="avatar">{initials(patient.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-title">{patient.name}</div>
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
          {tab === 'Histórico' && <HistoricoTab patientId={patient.id} />}
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
