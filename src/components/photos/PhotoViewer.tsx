import { useEffect, useState } from 'react';
import { Loader2, Pencil, X } from 'lucide-react';
import type { PatientPhoto, PatientPhotoSession } from '../../hooks/usePatientPhotos';
import type { PhotoAngle } from '../../lib/clinicalPhotos';

interface PhotoViewerProps {
  photo: PatientPhoto;
  sessions: PatientPhotoSession[];
  onGetUrl: (photo: PatientPhoto, variant: 'preview' | 'original') => Promise<string>;
  onUpdate: (photoId: string, patch: { angle?: PhotoAngle | null; region?: string | null; caption?: string | null; photo_session_id?: string | null }) => Promise<void>;
  onVoid: (photoId: string, reason: string) => Promise<void>;
  onClose: (changed: boolean) => void;
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR').format(date);
}

export default function PhotoViewer({ photo, onGetUrl, onClose }: PhotoViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(false);
    void onGetUrl(photo, 'preview')
      .then(value => { if (active) setUrl(value); })
      .catch(cause => {
        console.error('patient photo preview failed', cause);
        if (active) setError(true);
      });
    return () => { active = false; };
  }, [onGetUrl, photo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="simple-photo-viewer" role="dialog" aria-modal="true" aria-label="Visualizar foto da paciente">
      <header className="simple-photo-viewer__header">
        <div>
          <strong>Foto da paciente</strong>
          <span>{displayDate(photo.taken_at)}</span>
        </div>
        <button type="button" className="simple-photo-viewer__close" onClick={() => onClose(false)} aria-label="Fechar foto"><X size={23} /></button>
      </header>

      <div className="simple-photo-viewer__stage">
        {url ? <img src={url} alt="Foto ampliada da paciente" /> : error ? (
          <div className="simple-photo-viewer__error">
            <span>Não foi possível abrir esta foto agora.</span>
            <button type="button" className="btn btn-secondary" onClick={() => onClose(false)}>Fechar</button>
          </div>
        ) : (
          <div className="simple-photo-viewer__loading"><Loader2 size={28} className="photo-spin" /><span>Carregando foto…</span></div>
        )}
      </div>

      <footer className="simple-photo-viewer__footer">
        <p className={`simple-photo-viewer__caption${photo.caption ? '' : ' is-muted'}`}>{photo.caption || 'Sem observação'}</p>
        <button type="button" className="btn btn-secondary" onClick={() => onClose(false)}><Pencil size={16} /> Voltar e editar informações</button>
      </footer>
    </div>
  );
}
