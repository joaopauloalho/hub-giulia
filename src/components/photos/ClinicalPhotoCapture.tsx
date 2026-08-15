import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, RefreshCw, SwitchCamera, Upload, WifiOff, X } from 'lucide-react';
import {
  FACE_STANDARD_ANGLES,
  PHOTO_ANGLE_LABELS,
  PHOTO_REGION_OPTIONS,
  PHOTO_SESSION_LABELS,
  captureVideoFrame,
  type ClinicalPhotoSource,
  type PhotoAngle,
  type PhotoCaptureSet,
  type PhotoPose,
  type PhotoSessionType,
} from '../../lib/clinicalPhotos';
import type { CreatePhotoSessionInput, PatientPhotoSession } from '../../hooks/usePatientPhotos';

interface CaptureContext {
  appointmentId?: string | null;
  procedureId?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
}

interface UploadItem {
  id: string;
  file: File;
  angle: PhotoAngle | null;
  source: ClinicalPhotoSource;
  status: 'preparing' | 'sending' | 'saved' | 'error';
  error?: string;
}

interface ClinicalPhotoCaptureProps {
  context?: CaptureContext;
  existingSession?: PatientPhotoSession | null;
  referenceByAngle?: Partial<Record<PhotoAngle, string>>;
  onCreateSession: (input: CreatePhotoSessionInput) => Promise<PatientPhotoSession>;
  onUpload: (session: PatientPhotoSession, file: File, angle: PhotoAngle | null, source: ClinicalPhotoSource, uploadId: string, region: string | null, pose: PhotoPose | null) => Promise<void>;
  onClose: (changed: boolean) => void;
}

export default function ClinicalPhotoCapture({ context, existingSession, referenceByAngle = {}, onCreateSession, onUpload, onClose }: ClinicalPhotoCaptureProps) {
  const [session, setSession] = useState<PatientPhotoSession | null>(existingSession ?? null);
  const [sessionType, setSessionType] = useState<PhotoSessionType>(existingSession?.session_type ?? 'other');
  const [captureSet, setCaptureSet] = useState<PhotoCaptureSet>(existingSession?.capture_set ?? 'face_standard');
  const [region, setRegion] = useState<string>('Face');
  const [pose, setPose] = useState<PhotoPose>('rest');
  const [starting, setStarting] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [streamReady, setStreamReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [review, setReview] = useState<{ file: File; source: ClinicalPhotoSource; url: string } | null>(null);
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [freeAngle, setFreeAngle] = useState<PhotoAngle>('other');
  const [ghostEnabled, setGhostEnabled] = useState(false);
  const [ghostOpacity, setGhostOpacity] = useState(35);
  const [changed, setChanged] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lanesRef = useRef<[Promise<void>, Promise<void>]>([Promise.resolve(), Promise.resolve()]);
  const nextLaneRef = useRef(0);

  const existingAngles = useMemo(() => new Set((existingSession?.photos ?? []).map(photo => photo.angle).filter(Boolean) as PhotoAngle[]), [existingSession]);
  const queuedAngles = useMemo(() => new Set(queue.filter(item => item.status !== 'error').map(item => item.angle).filter(Boolean) as PhotoAngle[]), [queue]);
  const missingStandard = useMemo(() => FACE_STANDARD_ANGLES.filter(angle => !existingAngles.has(angle) && !queuedAngles.has(angle)), [existingAngles, queuedAngles]);
  const currentAngle = captureSet === 'free' ? freeAngle : (missingStandard[0] ?? 'other');
  const ghostUrl = currentAngle ? referenceByAngle[currentAngle] : undefined;
  const pendingCount = queue.filter(item => item.status !== 'saved').length;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setStreamReady(false);
  }, []);

  const startCamera = useCallback(async (nextFacing = facing) => {
    setCameraError(null);
    stopCamera();
    if (!navigator.onLine) {
      setCameraError('Conecte-se à internet para registrar fotos com segurança.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Câmera direta indisponível neste navegador. Use “Escolher arquivo”.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 2160 }, height: { ideal: 2160 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreamReady(true);
    } catch (cause) {
      const message = cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Permissão da câmera negada. Você pode escolher uma foto do aparelho.'
        : 'Não foi possível abrir a câmera. Você pode escolher uma foto do aparelho.';
      setCameraError(message);
    }
  }, [facing, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pendingCount === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingCount]);
  useEffect(() => () => {
    if (review) URL.revokeObjectURL(review.url);
  }, [review]);

  const begin = async () => {
    if (!navigator.onLine) {
      setCameraError('Conecte-se à internet para registrar fotos com segurança.');
      return;
    }
    setStarting(true);
    try {
      const created = session ?? await onCreateSession({
        appointmentId: context?.appointmentId ?? null,
        procedureId: context?.procedureId ?? null,
        serviceId: context?.serviceId ?? null,
        sessionType,
        captureSet,
      });
      setSession(created);
      await startCamera(facing);
    } finally {
      setStarting(false);
    }
  };

  const setReviewFile = (file: File, source: ClinicalPhotoSource) => {
    if (review) URL.revokeObjectURL(review.url);
    setReview({ file, source, url: URL.createObjectURL(file) });
  };

  const capture = async () => {
    if (!videoRef.current) return;
    try {
      setReviewFile(await captureVideoFrame(videoRef.current), 'camera');
    } catch (cause) {
      setCameraError(cause instanceof Error ? cause.message : 'Não foi possível capturar a foto.');
    }
  };

  const chooseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) setReviewFile(file, 'library');
  };

  const updateItem = (id: string, patch: Partial<UploadItem>) => setQueue(current => current.map(item => item.id === id ? { ...item, ...patch } : item));

  const runUpload = (item: UploadItem) => {
    if (!session) return;
    const lane = nextLaneRef.current % 2;
    nextLaneRef.current += 1;
    lanesRef.current[lane] = lanesRef.current[lane].then(async () => {
      updateItem(item.id, { status: 'sending', error: undefined });
      try {
        await onUpload(session, item.file, item.angle, item.source, item.id, region === 'Outro' ? 'Outro' : region, pose);
        updateItem(item.id, { status: 'saved' });
        setChanged(true);
      } catch (cause) {
        updateItem(item.id, { status: 'error', error: cause instanceof Error ? cause.message : 'Upload falhou.' });
      }
    });
  };

  const usePhoto = () => {
    if (!review || !session) return;
    const item: UploadItem = { id: crypto.randomUUID(), file: review.file, angle: currentAngle, source: review.source, status: 'preparing' };
    setQueue(current => [...current, item]);
    runUpload(item);
    URL.revokeObjectURL(review.url);
    setReview(null);
  };

  const repeat = () => {
    if (review) URL.revokeObjectURL(review.url);
    setReview(null);
  };

  const retry = (item: UploadItem) => {
    updateItem(item.id, { status: 'preparing', error: undefined });
    runUpload(item);
  };

  const switchCamera = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setFacing(next);
    await startCamera(next);
  };

  const close = () => {
    if (pendingCount > 0 && !window.confirm('Existem fotos que ainda não foram salvas. Se sair agora, elas serão descartadas da memória. Deseja sair?')) return;
    stopCamera();
    onClose(changed);
  };

  return (
    <div className="clinical-capture" role="dialog" aria-modal="true" aria-label="Captura de fotos clínicas">
      <header className="clinical-capture__header">
        <div>
          <strong>Fotos de hoje</strong>
          <span>{context?.serviceName || (context?.appointmentId ? 'Atendimento vinculado' : 'Sessão fotográfica')}</span>
        </div>
        <button className="icon-button" onClick={close} aria-label="Fechar captura"><X size={22} /></button>
      </header>

      {!session ? (
        <div className="clinical-capture__setup">
          <div className="capture-setup-card">
            <h3>Nova sessão fotográfica</h3>
            <label>Tipo da sessão
              <select value={sessionType} onChange={event => setSessionType(event.target.value as PhotoSessionType)}>
                {Object.entries(PHOTO_SESSION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>Captura
              <select value={captureSet} onChange={event => setCaptureSet(event.target.value as PhotoCaptureSet)}>
                <option value="face_standard">Face — padrão (5 ângulos)</option>
                <option value="free">Livre</option>
              </select>
            </label>
            <label>Região
              <select value={region} onChange={event => setRegion(event.target.value)}>
                {PHOTO_REGION_OPTIONS.map(option => <option key={option}>{option}</option>)}
              </select>
            </label>
            <label>Expressão
              <select value={pose} onChange={event => setPose(event.target.value as PhotoPose)}>
                <option value="rest">Repouso</option>
                <option value="smile">Sorriso</option>
                <option value="expression">Expressão</option>
                <option value="custom">Livre</option>
              </select>
            </label>
            <p className="privacy-note">A imagem é documentação clínica. O Hub não aplica filtro de beleza, análise facial nem IA. Fotos da biblioteca são normalizadas uma vez para remover EXIF/GPS desnecessário.</p>
            <button className="primary-action" disabled={starting} onClick={() => void begin()}>{starting ? <RefreshCw className="spin" size={18} /> : <Camera size={18} />} Começar captura</button>
          </div>
        </div>
      ) : (
        <div className="clinical-capture__body">
          <div className="capture-stage">
            <div className="capture-stage__topline">
              <div><span>Ângulo</span><strong>{PHOTO_ANGLE_LABELS[currentAngle]}</strong></div>
              {captureSet === 'free' && (
                <select value={freeAngle} onChange={event => setFreeAngle(event.target.value as PhotoAngle)} aria-label="Ângulo da foto livre">
                  {Object.entries(PHOTO_ANGLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              )}
              <button className="secondary-action" onClick={() => void switchCamera()}><SwitchCamera size={17} /> Trocar câmera</button>
            </div>

            <div className="camera-viewport">
              <video ref={videoRef} muted playsInline className={facing === 'user' ? 'is-mirrored' : ''} />
              <div className="camera-guide" aria-hidden="true"><div className="camera-guide__oval" /><div className="camera-guide__v" /><div className="camera-guide__h" /></div>
              {ghostEnabled && ghostUrl && <img className="ghost-reference" src={ghostUrl} alt="" style={{ opacity: ghostOpacity / 100 }} />}
              {review && <img className="capture-review" src={review.url} alt="Revisão da foto capturada" />}
              {!streamReady && !review && <div className="camera-empty"><Camera size={42} /><span>A câmera aparecerá aqui.</span></div>}
            </div>

            {ghostUrl && !review && (
              <div className="ghost-controls">
                <label><input type="checkbox" checked={ghostEnabled} onChange={event => setGhostEnabled(event.target.checked)} /> Usar foto anterior como referência</label>
                {ghostEnabled && <label>Opacidade <input type="range" min="10" max="80" value={ghostOpacity} onChange={event => setGhostOpacity(Number(event.target.value))} /></label>}
              </div>
            )}

            {cameraError && <div className="capture-error"><WifiOff size={18} /> {cameraError}</div>}

            <div className="capture-actions">
              {review ? (
                <>
                  <button className="secondary-action" onClick={repeat}><RefreshCw size={18} /> Repetir</button>
                  <button className="primary-action" onClick={usePhoto}><Check size={18} /> Usar foto</button>
                </>
              ) : (
                <>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture={facing} onChange={chooseFile} hidden />
                  <button className="secondary-action" onClick={() => fileRef.current?.click()}><Upload size={18} /> Escolher arquivo</button>
                  <button className="capture-shutter" onClick={() => void capture()} disabled={!streamReady} aria-label="Capturar foto"><span /></button>
                  <button className="secondary-action" onClick={() => void startCamera()}><Camera size={18} /> Abrir câmera</button>
                </>
              )}
            </div>
          </div>

          <aside className="upload-queue" aria-live="polite">
            <div className="upload-queue__title"><strong>Sessão</strong><span>{session.photos.length + queue.filter(item => item.status === 'saved').length} foto(s) salva(s)</span></div>
            {captureSet === 'face_standard' && <div className="capture-progress">{Math.min(5, existingAngles.size + queuedAngles.size)} de 5 ângulos organizados</div>}
            {queue.length === 0 ? <p>Nenhuma foto nova nesta abertura.</p> : queue.map(item => (
              <div className={`upload-item is-${item.status}`} key={item.id}>
                <div><strong>{item.angle ? PHOTO_ANGLE_LABELS[item.angle] : 'Foto livre'}</strong><span>{item.status === 'preparing' ? 'Preparando' : item.status === 'sending' ? 'Enviando' : item.status === 'saved' ? 'Salva' : 'Erro'}</span></div>
                {item.error && <small>{item.error}</small>}
                {item.status === 'error' && <button onClick={() => retry(item)}>Tentar novamente</button>}
              </div>
            ))}
            <button className="secondary-action add-free-photo" onClick={() => { setCaptureSet('free'); setFreeAngle('other'); }}>+ Foto livre</button>
          </aside>
        </div>
      )}
    </div>
  );
}
