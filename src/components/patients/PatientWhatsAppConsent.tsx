import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../hooks/useToast';
import type { Patient } from '../../types';

export function PatientWhatsAppConsent({ patient, onChanged }: { patient: Patient; onChanged?: (value: boolean) => void }) {
  const { toast } = useToast();
  const [allowed, setAllowed] = useState(Boolean(patient.whatsapp_opt_in && !patient.whatsapp_opt_out_at));
  const [source, setSource] = useState('ficha');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setAllowed(Boolean(patient.whatsapp_opt_in && !patient.whatsapp_opt_out_at)); }, [patient.whatsapp_opt_in, patient.whatsapp_opt_out_at, patient.id]);
  const save = async (value: boolean) => {
    setSaving(true);
    const { error } = await supabase.rpc('set_patient_whatsapp_consent_v1', {
      p_patient_id: patient.id, p_opt_in: value, p_source: value ? source : 'revogacao',
    });
    if (error) toast.error('Não foi possível atualizar a autorização.');
    else {
      setAllowed(value); onChanged?.(value);
      toast.success(value ? 'Autorização registrada.' : 'Autorização revogada. A paciente não entra mais nas campanhas.');
    }
    setSaving(false);
  };
  return <section className="card" style={{ padding: 14 }} aria-label="Consentimento para WhatsApp">
    <strong>WhatsApp e relacionamento (LGPD)</strong>
    <p className="page-sub">Registrar somente quando a paciente autorizou mensagens comerciais. Não presume autorização por possuir telefone.</p>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <input type="checkbox" checked={allowed} disabled={saving} onChange={event => void save(event.target.checked)} />
      <span>Paciente autorizou receber mensagens comerciais pelo WhatsApp</span>
    </label>
    <label className="field-label" htmlFor="opt-in-source">Origem da autorização</label>
    <select className="field-input" id="opt-in-source" value={source} disabled={saving} onChange={event => setSource(event.target.value)}>
      <option value="ficha">Ficha / recepção</option>
      <option value="anamnese">Anamnese</option>
      <option value="presencial">Conversou pessoalmente</option>
      <option value="whatsapp">Confirmou pelo WhatsApp</option>
    </select>
    {allowed && <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 10 }} disabled={saving} onClick={() => void save(false)}>Revogar autorização / não contatar</button>}
    {patient.opt_in_at && <div className="page-sub">Autorização registrada: {new Date(patient.opt_in_at).toLocaleDateString('pt-BR')}</div>}
  </section>;
}
