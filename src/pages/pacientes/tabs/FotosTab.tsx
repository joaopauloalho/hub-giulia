import { useEffect, useMemo, useState } from 'react';
import { Images, Pencil, Save } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { usePatientPhotos, type AttendancePhotoContext, type PatientPhoto, type PatientPhotoSession } from '../../../hooks/usePatientPhotos';
import ClinicalPhotoCapture from '../../../components/photos/ClinicalPhotoCapture';
import PhotoViewer from '../../../components/photos/PhotoViewer';
import '../photos.css';

interface FotosTabProps { patientId: string }

function displayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

function parseTypedDate(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4));
  const date = new Date(year, month - 1, day, 12, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.toISOString();
}

function PhotoCard({ photo, patientId, onOpen, onChanged }: { photo: PatientPhoto; patientId: string; onOpen: () => void; onChanged: () => void }) {
  const [date, setDate] = useState(displayDate(photo.taken_at));
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const takenAt = parseTypedDate(date);
    if (!takenAt) { setError('Digite a data no formato DD/MM/AAAA.'); return; }
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase.from('patient_photos').update({ taken_at: takenAt, caption: caption.trim() || null }).eq('id', photo.id).eq('patient_id', patientId);
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    setEditing(false);
    onChanged();
  };

  return (
    <article style={{ border: '1px solid #f3d7e2', borderRadius: 18, overflow: 'hidden', background: '#fff' }}>
      <button type="button" onClick={onOpen} style={{ display: 'block', width: '100%', padding: 0, border: 0, background: '#f7f7f8', cursor: 'pointer' }} aria-label="Abrir foto">
        {photo.thumbnail_url ? <img src={photo.thumbnail_url} alt="Foto clínica" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} /> : <div style={{ aspectRatio: '4 / 3', display: 'grid', placeItems: 'center', color: '#9ca3af' }}><Images size={30} /></div>}
      </button>
      <div style={{ padding: 14, display: 'grid', gap: 10 }}>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#6b7280' }}>
          Data da foto
          <input value={date} onChange={event => { setDate(event.target.value); setEditing(true); }} inputMode="numeric" placeholder="DD/MM/AAAA" style={{ minHeight: 42, border: '1px solid #e5e7eb', borderRadius: 10, padding: '0 11px', fontSize: 15 }} />
        </label>
        <label style={{ display: 'grid', gap: 5, fontSize: 12, color: '#6b7280' }}>
          Observação
          <textarea value={caption} onChange={event => { setCaption(event.target.value); setEditing(true); }} placeholder="Ex.: Antes, Depois de 15 dias, olheira…" rows={2} style={{ resize: 'vertical', border: '1px solid #e5e7eb', borderRadius: 10, padding: 10, font: 'inherit' }} />
        </label>
        {error && <small style={{ color: '#b42318' }}>{error}</small>}
        {editing ? <button type="button" onClick={() => void save()} disabled={saving} className="photo-primary-button" style={{ justifyContent: 'center' }}><Save size={16} />{saving ? 'Salvando…' : 'Salvar'}</button> : <button type="button" onClick={() => setEditing(true)} className="photo-secondary-button" style={{ justifyContent: 'center' }}><Pencil size={15} />Editar informações</button>}
      </div>
    </article>
  );
}

export function FotosTab({ patientId }: FotosTabProps) {
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointment_id');
  const photos = usePatientPhotos(patientId);
  const [attendanceContext, setAttendanceContext] = useState<AttendancePhotoContext | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewerPhoto, setViewerPhoto] = useState<PatientPhoto | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => { void photos.load(); }, [photos.load]);
  useEffect(() => {
    if (!appointmentId) { setAttendanceContext(null); return; }
    let active = true;
    void photos.getAttendanceContext(appointmentId).then(value => { if (active) setAttendanceContext(value); }).catch(() => { if (active) setAttendanceContext(null); });
    return () => { active = false; };
  }, [appointmentId, photos.getAttendanceContext]);

  const allPhotos = useMemo(() => {
    const map = new Map<string, PatientPhoto>();
    [...photos.sessions.flatMap(session => session.photos), ...photos.legacyPhotos].forEach(photo => map.set(photo.id, photo));
    return [...map.values()].sort((a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime());
  }, [photos.legacyPhotos, photos.sessions]);

  const groups = useMemo(() => {
    const map = new Map<string, PatientPhoto[]>();
    allPhotos.forEach(photo => {
      const key = displayDate(photo.taken_at);
      map.set(key, [...(map.get(key) ?? []), photo]);
    });
    return [...map.entries()];
  }, [allPhotos]);

  const upload = async (session: PatientPhotoSession, file: File, angle: Parameters<typeof photos.uploadPhoto>[0]['angle'], sourceType: Parameters<typeof photos.uploadPhoto>[0]['sourceType'], uploadId: string, region: string | null, pose: Parameters<typeof photos.uploadPhoto>[0]['pose']) => {
    await photos.uploadPhoto({ session, file, angle, sourceType, uploadId, region, pose });
  };

  return (
    <div className="photos-page">
      <section className="photos-hero" style={{ alignItems: 'center' }}>
        <div>
          <span className="photos-eyebrow"><Images size={16} /> GALERIA CLÍNICA</span>
          <h2>Fotos & evolução</h2>
          <p>Adicione fotos da galeria e escreva livremente a data e uma observação.</p>
        </div>
        <button type="button" className="photo-primary-button" onClick={() => setAdding(true)}><Images size={19} /> Adicionar fotos</button>
      </section>

      {(photos.error || localError) && <div className="photo-error">{photos.error || localError}</div>}

      {!photos.loading && allPhotos.length === 0 && (
        <section style={{ padding: '44px 24px', textAlign: 'center', border: '1px solid #f3d7e2', borderRadius: 18, background: '#fff' }}>
          <Images size={36} style={{ margin: '0 auto 12px', color: '#c02662' }} />
          <h3 style={{ margin: 0 }}>Nenhuma foto ainda</h3>
          <p style={{ color: '#6b7280' }}>Adicione uma ou várias fotos diretamente da galeria.</p>
          <button type="button" className="photo-primary-button" onClick={() => setAdding(true)}>Adicionar fotos</button>
        </section>
      )}

      <div style={{ display: 'grid', gap: 28 }}>
        {groups.map(([date, items]) => (
          <section key={date}>
            <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em' }}>{date}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
              {items.map(photo => <PhotoCard key={photo.id} photo={photo} patientId={patientId} onOpen={() => setViewerPhoto(photo)} onChanged={() => void photos.load()} />)}
            </div>
          </section>
        ))}
      </div>

      {adding && <ClinicalPhotoCapture context={attendanceContext ? { appointmentId: attendanceContext.appointmentId, procedureId: attendanceContext.procedureId, serviceId: attendanceContext.serviceId, serviceName: attendanceContext.serviceName } : undefined} onCreateSession={photos.createSession} onUpload={upload} onClose={changed => { setAdding(false); if (changed) void photos.load(); }} />}

      {viewerPhoto && <PhotoViewer photo={viewerPhoto} sessions={photos.sessions} onGetUrl={photos.getPhotoUrl} onUpdate={photos.updatePhotoMetadata} onVoid={photos.voidPhoto} onClose={changed => { setViewerPhoto(null); if (changed) void photos.load(); }} />}
    </div>
  );
}
