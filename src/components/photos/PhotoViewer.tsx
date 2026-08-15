import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Expand, Minus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { PHOTO_ANGLE_LABELS, PHOTO_REGION_OPTIONS, type PhotoAngle } from '../../lib/clinicalPhotos';
import type { PatientPhoto, PatientPhotoSession } from '../../hooks/usePatientPhotos';

interface PhotoViewerProps {
  photo: PatientPhoto;
  sessions: PatientPhotoSession[];
  onGetUrl: (photo: PatientPhoto, variant: 'preview' | 'original') => Promise<string>;
  onUpdate: (photoId: string, patch: { angle?: PhotoAngle | null; region?: string | null; caption?: string | null; photo_session_id?: string | null }) => Promise<void>;
  onVoid: (photoId: string, reason: string) => Promise<void>;
  onClose: (changed: boolean) => void;
}

export default function PhotoViewer({ photo, sessions, onGetUrl, onUpdate, onVoid, onClose }: PhotoViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [editing, setEditing] = useState(false);
  const [angle, setAngle] = useState<PhotoAngle | ''>(photo.angle ?? '');
  const [region, setRegion] = useState(photo.region ?? '');
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [sessionId, setSessionId] = useState(photo.photo_session_id ?? '');
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    let active = true;
    void onGetUrl(photo, 'preview').then(value => { if (active) setUrl(value); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Foto indisponível.'); });
    return () => { active = false; };
  }, [onGetUrl, photo]);

  const reset = () => { setZoom(1); setX(0); setY(0); };
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onUpdate(photo.id, {
        angle: angle || null,
        region: region.trim() || null,
        caption: caption.trim() || null,
        photo_session_id: sessionId || null,
      });
      setChanged(true);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar os metadados.');
    } finally {
      setSaving(false);
    }
  };

  const voidPhoto = async () => {
    const reason = window.prompt('Motivo da anulação da foto:');
    if (!reason) return;
    setSaving(true);
    try {
      await onVoid(photo.id, reason);
      onClose(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível anular a foto.');
      setSaving(false);
    }
  };

  const downloadOriginal = async () => {
    try {
      const original = await onGetUrl(photo, 'original');
      const anchor = document.createElement('a');
      anchor.href = original;
      anchor.download = `foto-clinica-${photo.id}.${photo.mime_type === 'image/png' ? 'png' : 'jpg'}`;
      anchor.rel = 'noopener';
      anchor.click();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Original indisponível.');
    }
  };

  return (
    <div className="photo-viewer" ref={rootRef} role="dialog" aria-modal="true" aria-label="Visualizador de foto clínica">
      <header>
        <div><strong>{photo.angle ? PHOTO_ANGLE_LABELS[photo.angle] : 'Foto clínica'}</strong><span>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(photo.taken_at))}</span></div>
        <div className="viewer-header-actions">
          <button className="secondary-action" onClick={() => void rootRef.current?.requestFullscreen?.()}><Expand size={17} /> Tela cheia</button>
          <button className="icon-button" onClick={() => onClose(changed)} aria-label="Fechar foto"><X size={22} /></button>
        </div>
      </header>

      <div className="viewer-body">
        <div className="viewer-image-area">
          {error && <div className="capture-error">{error}</div>}
          {url ? <img src={url} alt="Foto clínica" style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }} /> : !error && <div className="photo-skeleton" />}
          <div className="viewer-controls" aria-label="Zoom e pan">
            <button onClick={() => setZoom(value => Math.max(1, value - 0.2))} aria-label="Diminuir zoom"><Minus size={16} /></button>
            <button onClick={() => setZoom(value => Math.min(4, value + 0.2))} aria-label="Aumentar zoom"><Plus size={16} /></button>
            <button onClick={() => setX(value => value - 35)} aria-label="Mover para esquerda"><ChevronLeft size={16} /></button>
            <button onClick={() => setX(value => value + 35)} aria-label="Mover para direita"><ChevronRight size={16} /></button>
            <button onClick={() => setY(value => value - 35)} aria-label="Mover para cima"><ChevronUp size={16} /></button>
            <button onClick={() => setY(value => value + 35)} aria-label="Mover para baixo"><ChevronDown size={16} /></button>
            <button onClick={reset}>Reset</button>
          </div>
        </div>

        <aside className="viewer-metadata">
          {editing ? (
            <>
              <h3>Organização da foto</h3>
              <label>Ângulo<select value={angle} onChange={event => setAngle(event.target.value as PhotoAngle | '')}><option value="">Sem ângulo</option>{Object.entries(PHOTO_ANGLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Região<select value={region} onChange={event => setRegion(event.target.value)}><option value="">Sem região</option>{PHOTO_REGION_OPTIONS.map(option => <option key={option}>{option}</option>)}</select></label>
              <label>Sessão<select value={sessionId} onChange={event => setSessionId(event.target.value)}><option value="">Sem sessão</option>{sessions.map(session => <option value={session.session_id} key={session.session_id}>{new Intl.DateTimeFormat('pt-BR').format(new Date(session.captured_at))} · {session.service_name || 'Sessão'}</option>)}</select></label>
              <label>Legenda<textarea value={caption} maxLength={500} onChange={event => setCaption(event.target.value)} /></label>
              <div className="viewer-actions"><button className="secondary-action" onClick={() => setEditing(false)}>Cancelar</button><button className="primary-action" disabled={saving} onClick={() => void save()}>Salvar</button></div>
            </>
          ) : (
            <>
              <h3>Documento clínico</h3>
              <dl>
                <div><dt>Ângulo</dt><dd>{photo.angle ? PHOTO_ANGLE_LABELS[photo.angle] : 'Não informado'}</dd></div>
                <div><dt>Região</dt><dd>{photo.region || 'Não informada'}</dd></div>
                <div><dt>Legenda</dt><dd>{photo.caption || '—'}</dd></div>
                <div><dt>Formato canônico</dt><dd>{photo.mime_type || 'Legado'}</dd></div>
                {photo.sha256 && <div><dt>Integridade</dt><dd className="hash-value">SHA-256 · {photo.sha256.slice(0, 12)}…</dd></div>}
              </dl>
              <button className="secondary-action full-width" onClick={() => setEditing(true)}><Pencil size={17} /> Editar metadados</button>
              <button className="secondary-action full-width" onClick={() => void downloadOriginal()}><Download size={17} /> Baixar original</button>
              <button className="danger-action full-width" disabled={saving} onClick={() => void voidPhoto()}><Trash2 size={17} /> Anular foto</button>
              <p className="privacy-note">Editar metadados não substitui os pixels, path ou hash do original clínico.</p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
