import { useRef, useState } from 'react';
import { Images, Loader2, X } from 'lucide-react';
import type { ClinicalPhotoSource, PhotoAngle, PhotoPose } from '../../lib/clinicalPhotos';
import type { CreatePhotoSessionInput, PatientPhotoSession } from '../../hooks/usePatientPhotos';

interface CaptureContext {
  appointmentId?: string | null;
  procedureId?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
}

interface ClinicalPhotoCaptureProps {
  context?: CaptureContext;
  existingSession?: PatientPhotoSession | null;
  referenceByAngle?: Partial<Record<PhotoAngle, string>>;
  onCreateSession: (input: CreatePhotoSessionInput) => Promise<PatientPhotoSession>;
  onUpload: (session: PatientPhotoSession, file: File, angle: PhotoAngle | null, source: ClinicalPhotoSource, uploadId: string, region: string | null, pose: PhotoPose | null) => Promise<void>;
  onClose: (changed: boolean) => void;
}

export default function ClinicalPhotoCapture({ context, existingSession, onCreateSession, onUpload, onClose }: ClinicalPhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const session = existingSession ?? await onCreateSession({
        appointmentId: context?.appointmentId ?? null,
        procedureId: context?.procedureId ?? null,
        serviceId: context?.serviceId ?? null,
        sessionType: 'other',
        captureSet: 'free',
        title: context?.serviceName || 'Fotos clínicas',
      });
      const selected = Array.from(files);
      for (let index = 0; index < selected.length; index += 1) {
        setProgress(`Salvando ${index + 1} de ${selected.length}…`);
        await onUpload(session, selected[index], null, 'library', crypto.randomUUID(), null, null);
        setChanged(true);
      }
      onClose(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível adicionar as fotos.');
    } finally {
      setBusy(false);
      setProgress('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="photo-capture-overlay" role="dialog" aria-modal="true" aria-label="Adicionar fotos da galeria">
      <div className="photo-capture-shell" style={{ maxWidth: 560 }}>
        <div className="photo-capture-header">
          <div>
            <strong>Adicionar fotos</strong>
            <p>Escolha uma ou várias fotos da sua galeria.</p>
          </div>
          <button type="button" className="photo-icon-button" onClick={() => onClose(changed)} disabled={busy} aria-label="Fechar"><X size={22} /></button>
        </div>
        <div style={{ padding: 24 }}>
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={event => void importFiles(event.target.files)} />
          <button type="button" className="photo-primary-button" style={{ width: '100%', minHeight: 92, fontSize: 18, justifyContent: 'center' }} onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={24} className="photo-spin" /> : <Images size={25} />}
            {busy ? (progress || 'Salvando…') : 'Escolher fotos da galeria'}
          </button>
          <p style={{ margin: '14px 4px 0', color: '#6b7280', lineHeight: 1.5 }}>Você pode selecionar quantas fotos quiser de uma vez. Depois, na galeria da paciente, escreva a data e uma observação em cada foto.</p>
          {error && <div className="photo-error" style={{ marginTop: 16 }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
