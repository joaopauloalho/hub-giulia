import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { usePatientPhotos } from '../../../hooks/usePatientPhotos';
import type { PatientPhoto } from '../../../types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Props { patientId: string; }

export function FotosTab({ patientId }: Props) {
  const { photos, loading, load, upload, remove } = usePatientPhotos(patientId);
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState('');
  const [preview, setPreview] = useState<PatientPhoto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, [load]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await upload(file, label);
      setLabel('');
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (photo: PatientPhoto) => {
    if (!confirm('Excluir esta foto?')) return;
    await remove(photo);
    if (preview?.id === photo.id) setPreview(null);
  };

  const fmtDate = (iso: string) => {
    try { return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); }
    catch { return iso; }
  };

  return (
    <div style={{ padding: 20 }}>
      {/* Upload area */}
      <div style={{
        border: '2px dashed var(--border)',
        borderRadius: 'var(--radius)',
        padding: 20,
        marginBottom: 20,
        background: 'var(--bg-2)',
      }}>
        <div style={{ marginBottom: 10 }}>
          <label className="field-label">Etiqueta (opcional)</label>
          <input className="field-input" value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Ex: Antes do tratamento, Sessão 1..." />
        </div>
        <button
          className="btn btn--secondary btn--sm"
          style={{ width: '100%' }}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <><Upload size={15} /> Enviando...</>
          ) : (
            <><Camera size={15} /> Selecionar foto</>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment"
          style={{ display: 'none' }} onChange={handleFile} />
      </div>

      {/* Gallery */}
      {loading ? (
        <div className="loading-state">Carregando fotos...</div>
      ) : photos.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <Camera size={40} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
          <p>Nenhuma foto registrada.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {photos.map(photo => (
            <div key={photo.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
              background: 'var(--bg-2)',
            }}>
              <div
                style={{ position: 'relative', aspectRatio: '1', cursor: 'pointer' }}
                onClick={() => setPreview(photo)}
              >
                <img src={photo.photo_url} alt={photo.label ?? 'Foto'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <div style={{ padding: '8px 10px' }}>
                {photo.label && (
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
                    {photo.label}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                    {fmtDate(photo.taken_at)}
                  </span>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }}
                    onClick={() => handleRemove(photo)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {preview && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
            zIndex: 1000, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
          onClick={() => setPreview(null)}
        >
          <img src={preview.photo_url} alt={preview.label ?? 'Foto'}
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 8, objectFit: 'contain' }}
            onClick={e => e.stopPropagation()} />
          {preview.label && (
            <div style={{ color: '#fff', marginTop: 12, fontSize: '0.9rem' }}>{preview.label}</div>
          )}
          <button className="btn btn--ghost btn--sm"
            style={{ marginTop: 16, color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
            onClick={() => setPreview(null)}>
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
