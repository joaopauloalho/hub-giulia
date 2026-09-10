import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ImagePlus, Images, Loader2, MessageSquareText, Pencil, Save, Trash2, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { usePatientPhotos, type AttendancePhotoContext, type PatientPhoto, type PatientPhotoSession } from '../../../hooks/usePatientPhotos';
import PhotoViewer from '../../../components/photos/PhotoViewer';
import '../photos.css';
import '../photos-gallery.css';
import '../photos-management.css';

interface FotosTabProps { patientId: string }

type DayNoteMap = Record<string, string>;

function displayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

function photoDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKeyToIsoNoon(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0).toISOString();
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

function PhotoCard({ photo, patientId, onOpen, onDelete, onChanged }: {
  photo: PatientPhoto;
  patientId: string;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  onChanged: () => void;
}) {
  const [date, setDate] = useState(displayDate(photo.taken_at));
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const remove = async () => {
    if (!window.confirm('Excluir esta foto da galeria?')) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onChanged();
    } catch (cause) {
      console.error('patient photo delete failed', cause);
      setError('Não foi possível excluir a foto. Tente novamente.');
      setDeleting(false);
    }
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
          <div className="clinic-photo-card__editor-actions clinic-photo-card__editor-actions--managed">
            <button type="button" className="clinic-photo-delete-button" onClick={() => void remove()} disabled={saving || deleting}>
              {deleting ? <Loader2 size={16} className="photo-spin" /> : <Trash2 size={16} />} Excluir foto
            </button>
            <div>
              <button type="button" className="btn btn-secondary" onClick={cancel} disabled={saving || deleting}><X size={16} /> Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || deleting}>{saving ? <Loader2 size={16} className="photo-spin" /> : <Save size={16} />} Salvar</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="clinic-photo-card__meta">
          <div className="clinic-photo-card__copy">
            <strong><CalendarDays size={15} /> {displayDate(photo.taken_at)}</strong>
            <p className={photo.caption ? '' : 'is-muted'}>{photo.caption || 'Sem observação'}</p>
          </div>
          <button type="button" className="clinic-photo-edit-button" onClick={() => setEditing(true)} aria-label="Editar ou excluir foto"><Pencil size={17} /></button>
        </div>
      )}
    </article>
  );
}

function DayNote({ patientId, dateKey, note, onSaved }: {
  patientId: string;
  dateKey: string;
  note: string;
  onSaved: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!editing) setValue(note); }, [editing, note]);

  const save = async () => {
    const clean = value.trim();
    setSaving(true);
    setError(null);
    try {
      if (!clean) {
        const { error: deleteError } = await supabase
          .from('patient_photo_day_notes')
          .delete()
          .eq('patient_id', patientId)
          .eq('photo_date', dateKey);
        if (deleteError) throw deleteError;
      } else {
        const { error: upsertError } = await supabase
          .from('patient_photo_day_notes')
          .upsert({ patient_id: patientId, photo_date: dateKey, note: clean }, { onConflict: 'user_id,patient_id,photo_date' });
        if (upsertError) throw upsertError;
      }
      onSaved(clean);
      setEditing(false);
    } catch (cause) {
      console.error('patient photo day note save failed', cause);
      setError('Não foi possível salvar a observação geral. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className={`clinic-photo-day-note ${note ? 'has-note' : 'is-empty'}`}>
        <MessageSquareText size={16} />
        <button type="button" onClick={() => setEditing(true)}>
          {note ? <span>{note}</span> : <span>Adicionar observação geral deste dia</span>}
          <Pencil size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="clinic-photo-day-note-editor">
      <label>
        <span>Observação geral do dia <small>opcional</small></span>
        <textarea className="field-input" value={value} rows={3} maxLength={2000} autoFocus placeholder="Ex.: Fotos antes do procedimento. Paciente realizou preenchimento labial e mento." onChange={event => setValue(event.target.value)} />
      </label>
      {error && <p className="clinic-photo-inline-error">{error}</p>}
      <div>
        <button type="button" className="btn btn-secondary" onClick={() => { setValue(note); setError(null); setEditing(false); }} disabled={saving}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? <Loader2 size={16} className="photo-spin" /> : <Save size={16} />} Salvar observação</button>
      </div>
    </div>
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
  const [uploadDateOverride, setUploadDateOverride] = useState<string | null>(null);
  const [dayNotes, setDayNotes] = useState<DayNoteMap>({});

  const loadDayNotes = useCallback(async () => {
    const { data, error } = await supabase
      .from('patient_photo_day_notes')
      .select('photo_date,note')
      .eq('patient_id', patientId)
      .order('photo_date', { ascending: false });
    if (error) {
      console.error('patient photo day notes load failed', error);
      return;
    }
    const next: DayNoteMap = {};
    for (const row of data ?? []) next[String(row.photo_date)] = String(row.note ?? '');
    setDayNotes(next);
  }, [patientId]);

  useEffect(() => { void photos.load(); }, [photos.load]);
  useEffect(() => { void loadDayNotes(); }, [loadDayNotes]);
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
    const map = new Map<string, { label: string; items: PatientPhoto[] }>();
    allPhotos.forEach(photo => {
      const key = photoDateKey(photo.taken_at);
      const current = map.get(key);
      if (current) current.items.push(photo);
      else map.set(key, { label: displayDate(photo.taken_at), items: [photo] });
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

  const openPicker = (dateKey: string | null = null) => {
    setUploadDateOverride(dateKey);
    pickerRef.current?.click();
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    const selected = Array.from(files);
    const targetDate = uploadDateOverride;
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
            takenAt: targetDate ? dateKeyToIsoNoon(targetDate) : null,
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
      setUploadDateOverride(null);
      if (pickerRef.current) pickerRef.current.value = '';
    }
  };

  return (
    <div className="clinic-photos-page">
      <input ref={pickerRef} className="clinic-photo-native-input" type="file" accept="image/*,.heic,.heif" multiple onChange={event => void importFiles(event.target.files)} />

      <section className="clinic-photos-header">
        <div>
          <h2>Fotos</h2>
          <p>Galeria clínica da paciente. Adicione, edite ou exclua fotos quando precisar.</p>
        </div>
        <button type="button" className="btn btn-primary clinic-photos-add" onClick={() => openPicker()} disabled={uploading}>
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
          <button type="button" className="btn btn-primary" onClick={() => openPicker()}><ImagePlus size={18} /> Adicionar fotos</button>
        </section>
      ) : (
        <div className="clinic-photo-groups">
          {groups.map(([dateKey, group]) => (
            <section className="clinic-photo-group" key={dateKey}>
              <header className="clinic-photo-group__managed-header">
                <h3>{group.label}</h3>
                <div>
                  <span>{group.items.length} {group.items.length === 1 ? 'foto' : 'fotos'}</span>
                  <button type="button" className="clinic-photo-add-day" onClick={() => openPicker(dateKey)} disabled={uploading}><ImagePlus size={14} /> Adicionar neste dia</button>
                </div>
              </header>

              <DayNote
                patientId={patientId}
                dateKey={dateKey}
                note={dayNotes[dateKey] ?? ''}
                onSaved={value => setDayNotes(current => ({ ...current, [dateKey]: value }))}
              />

              <div className="clinic-photo-grid">
                {group.items.map(photo => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    patientId={patientId}
                    onOpen={() => setViewerPhoto(photo)}
                    onDelete={() => photos.voidPhoto(photo.id, 'Excluída da galeria pela profissional.')}
                    onChanged={() => void photos.load()}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {viewerPhoto && <PhotoViewer photo={viewerPhoto} sessions={photos.sessions} onGetUrl={photos.getPhotoUrl} onUpdate={photos.updatePhotoMetadata} onVoid={photos.voidPhoto} onClose={changed => { setViewerPhoto(null); if (changed) void photos.load(); }} />}
    </div>
  );
}
