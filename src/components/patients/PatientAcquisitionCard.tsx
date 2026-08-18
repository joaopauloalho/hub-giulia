import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Users } from 'lucide-react';
import type { Patient } from '../../types';
import { formatAcquisitionLabel } from '../../lib/acquisition';
import { supabase } from '../../lib/supabase';

type ReferredPatient = { id: string; name: string; archived: boolean; has_attendance: boolean };
type Summary = {
  referrer: { id: string; name: string; archived: boolean } | null;
  referred_count: number;
  referred_attended_count: number;
  referred_patients: ReferredPatient[];
};

export function PatientAcquisitionCard({ patient }: { patient: Patient }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.rpc('get_patient_referral_summary_v1', { p_patient_id: patient.id }).then(({ data, error }) => {
      if (error) { console.warn('[patient360:acquisition]', error); return; }
      if (alive) setSummary(data as Summary);
    });
    return () => { alive = false; };
  }, [patient.id, patient.referred_by_patient_id]);

  const referrerLabel = summary?.referrer?.name ?? patient.referrer_name ?? null;
  const origin = formatAcquisitionLabel(patient.acquisition_source, patient.acquisition_source_detail, referrerLabel);
  const manualReferral = patient.acquisition_source === 'referral' && !patient.referred_by_patient_id && Boolean(patient.referrer_name);

  return <div className="card" data-testid="patient-acquisition-card" style={{ padding: 14 }}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="section-title" style={{ marginBottom: 5 }}>Origem</div>
        <strong data-testid="patient-acquisition-label">{origin}</strong>
        {manualReferral && <div className="page-sub" style={{ marginTop: 2 }}>Pessoa indicadora não cadastrada.</div>}
      </div>
      {(summary?.referred_count ?? 0) > 0 && <div style={{ textAlign: 'right' }}><div className="section-title" style={{ marginBottom: 5 }}>Indicações</div><strong>{summary?.referred_count} paciente{summary?.referred_count === 1 ? '' : 's'}</strong></div>}
    </div>
    {(summary?.referred_count ?? 0) > 0 && <>
      <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => setOpen(value => !value)}><Users size={14} /> {open ? 'Ocultar' : 'Ver quem indicou'} {open ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}</button>
      {open && <div data-testid="patient-referrals-list" style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        <div className="page-sub">{summary?.referred_attended_count ?? 0} com atendimento registrado.</div>
        {summary?.referred_patients.map(item => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}><span>{item.name}{item.archived ? ' (arquivada)' : ''}</span><span className="page-sub">{item.has_attendance ? 'Com atendimento' : 'Sem atendimento'}</span></div>)}
      </div>}
    </>}
  </div>;
}
