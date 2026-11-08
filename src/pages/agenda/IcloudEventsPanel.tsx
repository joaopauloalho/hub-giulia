import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Link2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { usePacientes } from '../../hooks/usePacientes';
import { useToast } from '../../hooks/useToast';
import { clinicDateLabel, clinicTime } from '../../lib/agendaTime';

type ImportedEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  is_private: boolean;
  linked_patient_id: string | null;
  linked_appointment_id: string | null;
};

function PatientLink({ event, onSaved, onClose }: { event: ImportedEvent; onSaved: () => void; onClose: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [patientId, setPatientId] = useState(event.linked_patient_id ?? '');
  const [saving, setSaving] = useState(false);
  const { pacientes, hasMore, nextPage } = usePacientes({ search, pageSize: 50 });

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('icloud_calendar_events')
        .update({ linked_patient_id: patientId || null }).eq('id', event.id);
      if (error) throw error;
      toast.success(patientId ? 'Paciente vinculada ao evento do iCloud.' : 'Vínculo removido.');
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível vincular a paciente.');
    } finally { setSaving(false); }
  };

  return <div className="card" style={{ padding: 12, marginTop: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <strong style={{ flex: 1 }}>Vincular compromisso a uma paciente</strong>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={16}/></button>
    </div>
    <p className="page-sub" style={{ marginTop: 6 }}>O evento original continua no iCloud, sem criar atendimento nem alterar o calendário.</p>
    <label className="field-label">Buscar paciente cadastrada</label>
    <input className="field-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nome da paciente"/>
    <select className="field-input" style={{ marginTop: 8 }} value={patientId} onChange={e => setPatientId(e.target.value)}>
      <option value="">Nenhuma paciente vinculada</option>
      {event.linked_patient_id && !pacientes.some(p => p.id === event.linked_patient_id) &&
        <option value={event.linked_patient_id}>Paciente já vinculada</option>}
      {pacientes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
    {hasMore && <button className="btn btn--ghost btn--sm" type="button" onClick={() => void nextPage()}>Carregar mais pacientes</button>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
      <button className="btn btn--primary btn--sm" type="button" disabled={saving} onClick={() => void save()}>
        <Link2 size={14}/> {saving ? 'Salvando...' : 'Salvar vínculo'}
      </button>
    </div>
  </div>;
}

export function IcloudEventsPanel({ from, to, revision = 0 }: { from: string; to: string; revision?: number }) {
  const navigate = useNavigate();
  const { toast, confirm } = useToast();
  const [converting, setConverting] = useState<string | null>(null);
  const [events, setEvents] = useState<ImportedEvent[]>([]);
  const [selected, setSelected] = useState<ImportedEvent | null>(null);
  const [localRevision, setLocalRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const { data, error } = await supabase.from('icloud_calendar_events')
        .select('id,title,starts_at,ends_at,is_all_day,is_private,linked_patient_id,linked_appointment_id')
        .lt('starts_at', to).gt('ends_at', from).eq('is_deleted', false).order('starts_at');
      if (!disposed) {
        // The optional integration may not yet have its migration deployed.
        if (!error) setEvents((data ?? []) as ImportedEvent[]);
        else setEvents([]);
      }
    };
    void load();
    return () => { disposed = true; };
  }, [from, to, revision, localRevision]);

  const convert = async (event: ImportedEvent) => {
    if (!event.linked_patient_id || event.is_all_day) return;
    const ok = await confirm({
      title: 'Criar agendamento para essa paciente?',
      message: 'O Hub criara um agendamento vinculado ao evento ja existente no iCloud. O horario e o evento do iPhone nao serao modificados. Nenhum procedimento sera registrado.',
      confirmLabel: 'Criar agendamento', cancelLabel: 'Voltar', tone: 'warning',
    });
    if (!ok) return;
    setConverting(event.id);
    try {
      const { data, error } = await supabase.rpc('convert_icloud_event_v1', {
        p_event_id: event.id, p_service_id: null,
      });
      if (error) throw error;
      toast.success('Agendamento vinculado a paciente com sucesso.');
      setLocalRevision(v => v + 1);
      if (data) navigate(`/atendimento/${data}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Falha ao criar agendamento.');
    } finally { setConverting(null); }
  };

  if (events.length === 0) return null;
  return <div className="card" style={{ padding: 12, marginBottom: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <CalendarDays size={17}/><strong>Compromissos importados do iCloud ({events.length})</strong>
    </div>
    <div style={{ display: 'grid', gap: 8 }}>
      {events.map(event => <div key={event.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <strong>{event.is_private ? 'Compromisso privado' : event.title || 'Compromisso'}</strong>
            <div className="page-sub">
              {clinicDateLabel(event.starts_at)} · {event.is_all_day ? 'Dia inteiro' : clinicTime(event.starts_at) + '–' + clinicTime(event.ends_at)}
            </div>
            <div className="page-sub">{event.linked_patient_id ? 'Paciente vinculada' : 'Sem paciente vinculada'}{event.linked_appointment_id ? ' · Agendamento vinculado' : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button className="btn btn--secondary btn--sm" type="button"
              onClick={() => setSelected(current => current?.id === event.id ? null : event)}>
              <Link2 size={14}/> Vincular paciente
            </button>
            {event.linked_appointment_id ? <button type="button" className="btn btn--ghost btn--sm"
              onClick={() => navigate(`/atendimento/${event.linked_appointment_id}`)}>
              Abrir atendimento
            </button> : event.linked_patient_id && !event.is_all_day ?
              <button type="button" className="btn btn--primary btn--sm"
                disabled={converting !== null} onClick={() => void convert(event)}>
                {converting === event.id ? 'Criando...' : 'Criar agendamento'}
              </button> : null}
          </div>
        </div>
      </div>)}
    </div>
    {selected && <PatientLink key={selected.id} event={selected}
      onClose={() => setSelected(null)}
      onSaved={() => { setSelected(null); setLocalRevision(value => value + 1); }}/>}
  </div>;
}
