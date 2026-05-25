import { useState } from 'react';
import { format, isBefore, parseISO, startOfToday } from 'date-fns';
import { CheckCircle2, Circle, StickyNote } from 'lucide-react';
import { usePatientNotes } from '../../../hooks/usePatientNotes';
import { useToast } from '../../../hooks/useToast';

export function NotasTab({ patientId }: { patientId: string }) {
  const { notes, loading, error, create, update } = usePatientNotes({ patientId });
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await create({ patient_id: patientId, content: content.trim(), remind_at: remindAt || null });
      setContent('');
      setRemindAt('');
      toast.success('Nota salva.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar nota.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading-state">Carregando notas...</div>;
  if (error) return <div className="empty-state" style={{ padding: '32px 0' }}><p>{error}</p></div>;

  return (
    <div style={{ padding: 20 }}>
      <div className="card" style={{ marginBottom: 16, padding: 14 }}>
        <label className="field-label">Nova nota interna</label>
        <textarea className="field-input" rows={3} value={content} onChange={event => setContent(event.target.value)} placeholder="Escreva uma observacao para acompanhamento..." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'end', marginTop: 10 }}>
          <div>
            <label className="field-label">Lembrete</label>
            <input className="field-input" type="date" value={remindAt} onChange={event => setRemindAt(event.target.value)} />
          </div>
          <button className="btn btn--primary btn--md" onClick={handleSave} disabled={saving || !content.trim()}>
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <StickyNote size={40} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
          <p>Nenhuma nota interna.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {notes.map(note => {
            const overdue = note.remind_at ? isBefore(parseISO(note.remind_at), startOfToday()) && !note.resolved : false;
            return (
              <div key={note.id} className="card" style={{ padding: 14, background: overdue ? '#fffbf0' : 'var(--bg)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <button
                    type="button"
                    aria-label={note.resolved ? 'Marcar como pendente' : 'Marcar como resolvida'}
                    onClick={() => update(note.id, { resolved: !note.resolved })}
                    style={{ border: 'none', background: 'transparent', color: note.resolved ? 'var(--green)' : 'var(--text-3)', cursor: 'pointer', padding: 2 }}
                  >
                    {note.resolved ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                  </button>
                  <div style={{ flex: 1 }}>
                    <p style={{ color: note.resolved ? 'var(--text-3)' : 'var(--text)', textDecoration: note.resolved ? 'line-through' : 'none', lineHeight: 1.55 }}>{note.content}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: '0.76rem', color: 'var(--text-3)' }}>
                      <span>{format(new Date(note.created_at), 'dd/MM/yyyy HH:mm')}</span>
                      {note.remind_at && <span className={overdue ? 'badge badge--amber' : 'badge badge--rose'}>Lembrete {format(parseISO(note.remind_at), 'dd/MM/yyyy')}</span>}
                      {note.resolved && <span className="badge badge--green">Resolvida</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
