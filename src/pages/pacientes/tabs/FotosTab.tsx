import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ImagePlus, Images, Loader2, Pencil, Save, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { usePatientPhotos, type AttendancePhotoContext, type PatientPhoto, type PatientPhotoSession } from '../../../hooks/usePatientPhotos';
import PhotoViewer from '../../../components/photos/PhotoViewer';
import '../photos.css';
import '../photos-gallery.css';

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

function formatDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join('/');
}

function friendlyPhotoError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/offline|network|fetch|internet/i.test(message)) return 'Confira a internet e tente novamente.';
  if (/size|grande|30 MB|18 MB|resolution|resolução/i.test(message)) return 'A foto é muito grande. Escolha uma versão menor.';
  return 'A foto não pôde ser preparada. Tente novamente ou escolha outra foto da galeria.';
}

async function normalizeGalleryImage(file: File): Promise<File> {
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) throw new Error('unsupported image');
  if (!file.size) throw new Error('empty image');
  if (file.size > 50 * 1024 * 1024) throw new Error('image too large');

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('invalid image');

    const maxSide = 5000;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('image conversion failed')), 'image/jpeg', 0.94);
    });
    return new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PhotoCard({ photo, patientId, onOpen, onChanged }: { photo: PatientPhoto; patientId: string; onOpen: () => void; onChanged: () => void }) {
  const [date, setDate] = useState(displayDate(photo.taken_at));
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDate(displayDate(photo.taken_at));
    setCaption(photo.caption ?? '');
  }, [photo.caption, photo.taken_at]);

  const save = async () => {
    const takenAt = parseTypedDate(date);
    if (!takenAt) {
      setError('Digite uma data válida no formato DD/MM/AAAA.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabase
      .from('patient_photos')
      .update({ taken_at: takenAt, caption: caption.trim() || null })
      .eq('id', photo.id)
      .eq('patient_id', patientId);
    setSaving(false);
    if (updateError) {
      console.error('patient photo metadata update failed', updateError);
      setError('Não foi possível salvar as informações da foto. Tente novamente.');
      return;
    }
    setEditing(false);
    onChanged();
  };

  const cancel = () => {
    setDate(displayDate(photo.taken_at));
    setCaption(photo.caption ?? '');
    setError(null);
    setEditing(false);
  };

  return (
    <article className="clinic-photo-card">
      <button type="button" className="clinic-photo-card__image" onClick={onOpen} aria-label={`Abrir foto de ${displayDate(photo.taken_at)}`}>
        {photo.thumbnail_url ? <img src={photo.thumbnail_url} alt="Foto da paciente" loading="lazy" /> : <span className="clinic-photo-placeholder"><Images size={28} /></span>}
      </button>

      {editing ? (
        <div className="clinic-photo-card__editor">
          <label className="clinic-photo-field">
            <span>Data da foto</span>
            <input className="field-input" value={date} inputMode="numeric" autoComplete="off" placeholder="DD/MM/AAAA" onChange={event => setDate(formatDateInput(event.target.value))} />
          </label>
          <label className="clinic-photo-field">
            <span>Observação <small>opcional</small></span>
            <textarea className="field-input" value={caption} maxLength={500} rows={2} placeholder="Ex.: Antes, depois de 15 dias, olheira…" onChange={event => setCaption(event.target.value)} />
          </label>
          {error && <p className="clinic-photo-inline-error">{error}</p>}
          <div className="clinic-photo-card__editor-actions">
            <button type="button" className="btn btn-secondary" onClick={cancel} disabled={saving}><X size={16} /> Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={16} className="photo-spin" /> : <Save size={16} />} Salvar</button>
          </div>
        </div>
      ) : (
        <div className="clinic-photo-card__meta">
          <div className="clinic-photo-card__copy">
            <strong><CalendarDays size={15} /> {displayDate(photo.taken_at)}</strong>
            <p className={photo.caption ? '' : 'is-muted'}>{photo.caption || 'Sem observação'}</p>
          </div>
          <button type="button" className="clinic-photo-edit-button" onClick={() => setEditing(true)} aria-label="Editar data e observação"><Pencil size={17} /></button>
        </div>
      )}
    </article>
  );
}

export function FotosTab({ patientId }: FotosTabProps) {
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointment_id');
  const photos = usePatientPhotos(patientId);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [attendanceContext, setAttendanceContext] = useState<AttendancePhotoContext | null>(null);
  const [viewerPhoto, setViewerPhoto] = useState<PatientPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => { void photos.load(); }, [photos.load]);
  useEffect(() => {
    if (!appointmentId) { setAttendanceContext(null); return; }
    let active = true;
    void photos.getAttendanceContext(appointmentId)
      .then(value => { if (active) setAttendanceContext(value); })
      .catch(() => { if (active) setAttendanceContext(null); });
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

  const createGallerySession = async (): Promise<PatientPhotoSession> => photos.createSession({
    appointmentId: attendanceContext?.appointmentId ?? null,
    procedureId: attendanceContext?.procedureId ?? null,
    serviceId: attendanceContext?.serviceId ?? null,
    sessionType: 'other',
    captureSet: 'free',
    title: attendanceContext?.serviceName || 'Fotos clínicas',
  });

  const importFiles = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    const selected = Array.from(files);
    setUploading(true);
    setUploadError(null);
    let session: PatientPhotoSession | null = null;
    let savedCount = 0;
    const failures: string[] = [];

    try {
      for (let index = 0; index < selected.length; index += 1) {
        setUploadProgress(`Salvando ${index + 1} de ${selected.length}`);
        try {
          const normalized = await normalizeGalleryImage(selected[index]);
          session ??= await createGallerySession();
          await photos.uploadPhoto({
            session,
            file: normalized,
            angle: null,
            sourceType: 'library',
            uploadId: crypto.randomUUID(),
            region: null,
            pose: null,
          });
          savedCount += 1;
        } catch (cause) {
          console.error('gallery photo import item failed', cause);
          failures.push(friendlyPhotoError(cause));
        }
      }
      if (savedCount > 0) await photos.load();
      if (failures.length > 0) {
        setUploadError(savedCount > 0
          ? `${savedCount} ${savedCount === 1 ? 'foto foi salva' : 'fotos foram salvas'}, mas ${failures.length} ${failures.length === 1 ? 'não pôde ser adicionada' : 'não puderam ser adicionadas'}. ${failures[0]}`
          : `Nenhuma foto foi salva. ${failures[0]}`);
      }
    } finally {
      setUploading(false);
      setUploadProgress('');
      if (pickerRef.current) pickerRef.current.value = '';
    }
  };

  return (
    <div className="clinic-photos-page">
      <input ref={pickerRef} className="clinic-photo-native-input" type="file" accept="image/*,.heic,.heif" multiple onChange={event => void importFiles(event.target.files)} />

      <section className="clinic-photos-header">
        <div>
          <h2>Fotos</h2>
          <p>Galeria clínica da paciente. Adicione fotos e registre a data e uma observação quando precisar.</p>
        </div>
        <button type="button" className="btn btn-primary clinic-photos-add" onClick={() => pickerRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 size={19} className="photo-spin" /> : <ImagePlus size={19} />}
          {uploading ? uploadProgress || 'Salvando…' : 'Adicionar fotos'}
        </button>
      </section>

      {uploadError && <div className="clinic-photo-message is-error" role="alert">{uploadError}<button type="button" onClick={() => setUploadError(null)} aria-label="Fechar aviso"><X size={17} /></button></div>}
      {photos.error && !uploadError && <div className="clinic-photo-message is-error" role="alert">Não foi possível carregar a galeria. Tente novamente.</div>}

      {photos.loading && allPhotos.length === 0 ? (
        <div className="clinic-photos-loading"><Loader2 size={24} className="photo-spin" /><span>Carregando fotos…</span></div>
      ) : allPhotos.length === 0 ? (
        <section className="clinic-photos-empty">
          <span><Images size={30} /></span>
          <h3>Nenhuma foto ainda</h3>
          <p>Adicione a primeira foto diretamente da galeria do iPad.</p>
          <button type="button" className="btn btn-primary" onClick={() => pickerRef.current?.click()}><ImagePlus size={18} /> Adicionar fotos</button>
        </section>
      ) : (
        <div className="clinic-photo-groups">
          {groups.map(([date, items]) => (
            <section className="clinic-photo-group" key={date}>
              <header><h3>{date}</h3><span>{items.length} {items.length === 1 ? 'foto' : 'fotos'}</span></header>
              <div className="clinic-photo-grid">
                {items.map(photo => <PhotoCard key={photo.id} photo={photo} patientId={patientId} onOpen={() => setViewerPhoto(photo)} onChanged={() => void photos.load()} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {viewerPhoto && <PhotoViewer photo={viewerPhoto} sessions={photos.sessions} onGetUrl={photos.getPhotoUrl} onUpdate={photos.updatePhotoMetadata} onVoid={photos.voidPhoto} onClose={changed => { setViewerPhoto(null); if (changed) void photos.load(); }} />}
    </div>
  );
}
