import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Camera, Clock3, Filter, Images, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  FACE_STANDARD_ANGLES,
  PHOTO_ANGLE_LABELS,
  PHOTO_SESSION_LABELS,
  type PhotoAngle,
  type PhotoSessionType,
} from '../../../lib/clinicalPhotos';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import {
  usePatientPhotos,
  type AttendancePhotoContext,
  type PatientPhoto,
  type PatientPhotoSession,
  type PhotoSessionFilters,
} from '../../../hooks/usePatientPhotos';
import ClinicalPhotoCapture from '../../../components/photos/ClinicalPhotoCapture';
import PhotoComparison from '../../../components/photos/PhotoComparison';
import PhotoViewer from '../../../components/photos/PhotoViewer';
import '../photos.css';

interface FotosTabProps { patientId: string }
interface ComparisonState { before: PatientPhotoSession; after: PatientPhotoSession; urls: Map<string, string | null> }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function commonAngleCount(a: PatientPhotoSession, b: PatientPhotoSession) {
  const angles = new Set(a.photos.map(photo => photo.angle).filter((angle): angle is PhotoAngle => Boolean(angle)));
  return b.photos.filter(photo => photo.angle && angles.has(photo.angle)).length;
}

export function FotosTab({ patientId }: FotosTabProps) {
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointment_id');
  const { online } = useNetworkStatus();
  const photos = usePatientPhotos(patientId);
  const [sessionType, setSessionType] = useState<PhotoSessionType | ''>('');
  const [serviceId, setServiceId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [attendanceContext, setAttendanceContext] = useState<AttendancePhotoContext | null>(null);
  const [captureSession, setCaptureSession] = useState<PatientPhotoSession | null | undefined>(undefined);
  const [viewerPhoto, setViewerPhoto] = useState<PatientPhoto | null>(null);
  const [comparisonDraft, setComparisonDraft] = useState<{ beforeId: string; afterId: string } | null>(null);
  const [comparison, setComparison] = useState<ComparisonState | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [preparingComparison, setPreparingComparison] = useState(false);

  const filters = useMemo<PhotoSessionFilters>(() => ({ serviceId: serviceId || null, sessionType, from, to }), [from, serviceId, sessionType, to]);

  useEffect(() => { void photos.load(filters); }, [photos.load, filters]);
  useEffect(() => {
    if (!appointmentId) { setAttendanceContext(null); return; }
    let active = true;
    void photos.getAttendanceContext(appointmentId)
      .then(value => { if (active) setAttendanceContext(value); })
      .catch(() => { if (active) setAttendanceContext(null); });
    return () => { active = false; };
  }, [appointmentId, photos.getAttendanceContext]);

  const services = useMemo(() => {
    const map = new Map<string, string>();
    photos.sessions.forEach(session => {
      if (session.service_id && session.service_name) map.set(session.service_id, session.service_name);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [photos.sessions]);

  const referenceByAngle = useMemo(() => {
    const target = captureSession ?? null;
    const targetDate = target ? new Date(target.captured_at).getTime() : Date.now();
    const targetService = target?.service_id ?? attendanceContext?.serviceId ?? null;
    const previous = photos.sessions
      .filter(session => session.session_id !== target?.session_id && new Date(session.captured_at).getTime() < targetDate)
      .sort((a, b) => Number(Boolean(targetService && b.service_id === targetService)) - Number(Boolean(targetService && a.service_id === targetService)) || new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())[0];
    const map: Partial<Record<PhotoAngle, string>> = {};
    previous?.photos.forEach(photo => {
      if (photo.angle && photo.thumbnail_url && !map[photo.angle]) map[photo.angle] = photo.thumbnail_url;
    });
    return map;
  }, [attendanceContext?.serviceId, captureSession, photos.sessions]);

  const startCapture = (session: PatientPhotoSession | null = null) => {
    setLocalError(null);
    if (!online) { setLocalError('Conecte-se à internet para registrar fotos com segurança.'); return; }
    setCaptureSession(session);
  };

  const suggestComparison = (clicked: PatientPhotoSession) => {
    const other = photos.sessions
      .filter(session => session.session_id !== clicked.session_id)
      .sort((a, b) => Number(Boolean(clicked.service_id && b.service_id === clicked.service_id)) - Number(Boolean(clicked.service_id && a.service_id === clicked.service_id)) || commonAngleCount(clicked, b) - commonAngleCount(clicked, a) || Math.abs(new Date(clicked.captured_at).getTime() - new Date(a.captured_at).getTime()) - Math.abs(new Date(clicked.captured_at).getTime() - new Date(b.captured_at).getTime()))[0];
    if (!other) { setLocalError('É necessária outra sessão para comparar.'); return; }
    const clickedLater = new Date(clicked.captured_at).getTime() >= new Date(other.captured_at).getTime();
    setComparisonDraft({ beforeId: clickedLater ? other.session_id : clicked.session_id, afterId: clickedLater ? clicked.session_id : other.session_id });
  };

  const prepareComparison = async () => {
    if (!comparisonDraft || comparisonDraft.beforeId === comparisonDraft.afterId) { setLocalError('Escolha duas sessões diferentes.'); return; }
    const before = photos.sessions.find(session => session.session_id === comparisonDraft.beforeId);
    const after = photos.sessions.find(session => session.session_id === comparisonDraft.afterId);
    if (!before || !after) return;
    setPreparingComparison(true);
    try {
      const urls = await photos.signPhotoPreviews([...before.photos, ...after.photos]);
      setComparison({ before, after, urls });
      setComparisonDraft(null);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Não foi possível abrir a comparação.');
    } finally {
      setPreparingComparison(false);
    }
  };

  const reload = () => photos.load(filters);

  return (
    <section className="photos-v2">
      <div className="photos-v2__hero">
        <div>
          <span className="eyebrow"><Images size={15} /> Documentação clínica</span>
          <h2>Fotos & evolução</h2>
          <p>Sessões organizadas por contexto, com original clínico imutável, resumo escrito e comparação sem retoque.</p>
          {attendanceContext && <div className="attendance-photo-context"><Clock3 size={16} /><span>Atendimento aberto · <strong>{attendanceContext.serviceName || 'Serviço vinculado'}</strong></span></div>}
        </div>
        <button className="primary-action capture-cta" onClick={() => startCapture()}><Camera size={19} /> Adicionar fotos</button>
      </div>

      {(localError || photos.error) && <div className="photos-error">{localError || photos.error}</div>}

      <div className="photo-filters">
        <span><Filter size={16} /> Filtros</span>
        <select aria-label="Filtrar por serviço" value={serviceId} onChange={event => setServiceId(event.target.value)}><option value="">Todos os serviços</option>{services.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select aria-label="Filtrar por tipo de sessão" value={sessionType} onChange={event => setSessionType(event.target.value as PhotoSessionType | '')}><option value="">Todos os tipos</option>{Object.entries(PHOTO_SESSION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <label>De <input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label>Até <input type="date" value={to} onChange={event => setTo(event.target.value)} /></label>
      </div>

      {photos.loading && photos.sessions.length === 0 ? <div className="session-skeletons"><div /><div /></div> : photos.sessions.length === 0 && photos.legacyPhotos.length === 0 ? (
        <div className="photos-empty"><Camera size={36} /><h3>Nenhuma sessão fotográfica</h3><p>Adicione fotos da câmera ou da galeria e registre a evolução clínica.</p><button className="primary-action" onClick={() => startCapture()}>Adicionar fotos</button></div>
      ) : (
        <div className="photo-timeline">
          {photos.sessions.map((session, index) => {
            const standardCount = new Set(session.photos.map(photo => photo.angle).filter((angle): angle is PhotoAngle => Boolean(angle) && FACE_STANDARD_ANGLES.some(expected => expected === angle))).size;
            return <article className="photo-session-card" key={session.session_id}>
              <div className="timeline-marker"><span>{index + 1}</span></div>
              <div className="photo-session-card__content">
                <header><div><time>{formatDate(session.captured_at)}</time><h3>{PHOTO_SESSION_LABELS[session.session_type]}</h3><p>{session.service_name || session.title || 'Sessão fotográfica'}</p></div><div className="session-count"><strong>{session.photo_count}</strong><span>foto{session.photo_count === 1 ? '' : 's'}</span></div></header>
                {session.notes && <div style={{ margin: '10px 0', padding: 11, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}><strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Resumo / evolução da sessão</strong><p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{session.notes}</p></div>}
                {session.capture_set === 'face_standard' && <div className="session-progress"><span style={{ width: `${Math.min(100, standardCount * 20)}%` }} /><small>{standardCount} de 5 ângulos organizados</small></div>}
                <div className="session-thumbs">{session.photos.slice(0, 5).map(photo => photo.thumbnail_url ? <button key={photo.id} onClick={() => setViewerPhoto(photo)} aria-label={`Abrir ${photo.angle ? PHOTO_ANGLE_LABELS[photo.angle] : 'foto clínica'}`}><img loading="lazy" src={photo.thumbnail_url} alt={photo.angle ? PHOTO_ANGLE_LABELS[photo.angle] : 'Foto clínica'} /></button> : <div className="photo-skeleton" key={photo.id} />)}{session.photos.length === 0 && <span className="empty-session-copy">Sessão criada, ainda sem fotos. Pode continuar depois.</span>}</div>
                <footer><button className="secondary-action" onClick={() => startCapture(session)}><Camera size={16} /> Adicionar fotos</button><button className="secondary-action" disabled={photos.sessions.length < 2} onClick={() => suggestComparison(session)}><ArrowLeftRight size={16} /> Comparar</button></footer>
              </div>
            </article>;
          })}
        </div>
      )}

      {photos.hasMore && <button className="secondary-action load-more" disabled={photos.loading} onClick={() => void photos.loadMore(filters)}>{photos.loading && <RefreshCw className="spin" size={17} />} Carregar sessões anteriores</button>}

      {photos.legacyPhotos.length > 0 && <section className="legacy-photos"><div><h3>Fotos anteriores</h3><p>Registros históricos sem sessão. O Hub não inventou ângulo, serviço ou contexto.</p></div><div className="legacy-grid">{photos.legacyPhotos.map(photo => <button key={photo.id} onClick={() => setViewerPhoto(photo)}>{photo.thumbnail_url ? <img loading="lazy" src={photo.thumbnail_url} alt="Foto clínica histórica" /> : <div className="photo-skeleton" />}<span>{formatDate(photo.taken_at)}</span></button>)}</div></section>}

      {comparisonDraft && <div className="comparison-picker" role="dialog" aria-modal="true" aria-label="Escolher sessões para comparação"><div><h3>Comparar sessões</h3><label>Antes<select value={comparisonDraft.beforeId} onChange={event => setComparisonDraft(current => current ? { ...current, beforeId: event.target.value } : null)}>{photos.sessions.map(session => <option key={session.session_id} value={session.session_id}>{formatDate(session.captured_at)} · {session.service_name || PHOTO_SESSION_LABELS[session.session_type]}</option>)}</select></label><label>Depois<select value={comparisonDraft.afterId} onChange={event => setComparisonDraft(current => current ? { ...current, afterId: event.target.value } : null)}>{photos.sessions.map(session => <option key={session.session_id} value={session.session_id}>{formatDate(session.captured_at)} · {session.service_name || PHOTO_SESSION_LABELS[session.session_type]}</option>)}</select></label><p>O Hub sugere por contexto e ângulos estruturados; você confirma. Não há matching por IA.</p><footer><button className="secondary-action" onClick={() => setComparisonDraft(null)}>Cancelar</button><button className="primary-action" disabled={preparingComparison || comparisonDraft.beforeId === comparisonDraft.afterId} onClick={() => void prepareComparison()}>{preparingComparison ? 'Preparando…' : 'Comparar'}</button></footer></div></div>}

      {captureSession !== undefined && <ClinicalPhotoCapture
        context={{ appointmentId, procedureId: attendanceContext?.procedureId, serviceId: attendanceContext?.serviceId, serviceName: attendanceContext?.serviceName }}
        existingSession={captureSession}
        referenceByAngle={referenceByAngle}
        onCreateSession={photos.createSession}
        onUpload={async (session, file, angle, source, uploadId, photoRegion, pose) => { await photos.uploadPhoto({ session, file, angle, sourceType: source, uploadId, region: photoRegion, pose }); }}
        onClose={() => { setCaptureSession(undefined); void reload(); }}
      />}
      {viewerPhoto && <PhotoViewer photo={viewerPhoto} sessions={photos.sessions} onGetUrl={photos.getPhotoUrl} onUpdate={photos.updatePhotoMetadata} onVoid={photos.voidPhoto} onClose={changed => { setViewerPhoto(null); if (changed) void reload(); }} />}
      {comparison && <PhotoComparison beforeSession={comparison.before} afterSession={comparison.after} previewUrls={comparison.urls} onClose={() => setComparison(null)} />}
    </section>
  );
}

export default FotosTab;