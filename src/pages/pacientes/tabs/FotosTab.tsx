import { useEffect, useRef, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { usePatientPhotos } from '../../../hooks/usePatientPhotos';
import { useProcedures } from '../../../hooks/useProcedures';
import { useToast } from '../../../hooks/useToast';
import type { PatientPhoto } from '../../../types';

interface Props { patientId: string; }

export function FotosTab({ patientId }: Props) {
  const { photos, loading, error, load, upload, remove } = usePatientPhotos(patientId);
  const { procedures } = useProcedures(patientId);
  const { confirm, toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState('');
  const [photoType, setPhotoType] = useState<PatientPhoto['photo_type']>('general');
  const [procedureId, setProcedureId] = useState('');
  const [preview, setPreview] = useState<PatientPhoto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (iso: string) => {
    try { return format(new Date(iso), "dd/MM/yyyy 'as' HH:mm", { locale: ptBR }); }
    catch { return iso; }
  };

  const fmtProcedure = (iso: string) => {
    try { return format(new Date(iso), 'dd/MM/yyyy', { locale: ptBR }); }
    catch { return iso; }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await upload(file, label, { photo_type: photoType, procedure_id: procedureId || null });
      setLabel('');
      setPhotoType('general');
      setProcedureId('');
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Foto enviada.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar foto.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (photo: PatientPhoto) => {
    const ok = await confirm({
      title: 'Excluir foto',
      message: 'Excluir esta foto?',
      confirmLabel: 'Excluir',
      tone: 'danger',
    });
    if (!ok) return;
    await remove(photo);
    if (preview?.id === photo.id) setPreview(null);
  };

  const generalPhotos = photos.filter(photo => photo.photo_type === 'general');
  const beforeAfter = photos.filter(photo => photo.photo_type !== 'general');
  const procedureGroups = beforeAfter.reduce<Record<string, PatientPhoto[]>>((acc, photo) => {
    const key = photo.procedure_id ?? 'sem-procedimento';
    acc[key] = [...(acc[key] ?? []), photo];
    return acc;
  }, {});

  const renderPhotoCard = (photo: PatientPhoto) => (
    <div key={photo.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg-2)' }}>
      <div style={{ position: 'relative', aspectRatio: '1', cursor: 'pointer' }} onClick={() => setPreview(photo)}>
        <img src={photo.photo_url} alt={photo.label ?? 'Foto'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        <span className="badge badge--rose" style={{ position: 'absolute', left: 8, top: 8 }}>
          {photo.photo_type === 'before' ? 'Antes' : photo.photo_type === 'after' ? 'Depois' : 'Geral'}
        </span>
      </div>
      <div style={{ padding: '8px 10px' }}>
        {photo.label && <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{photo.label}</div>}
        {photo.procedure?.performed_at && <div style={{ fontSize: '0.74rem', color: 'var(--primary)', marginBottom: 2 }}>Procedimento {fmtProcedure(photo.procedure.performed_at)}</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{fmtDate(photo.taken_at)}</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 4 }} onClick={() => handleRemove(photo)} aria-label="Excluir foto">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: 20 }}>
      <div style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, background: 'var(--bg-2)' }}>
        <div style={{ marginBottom: 10 }}>
          <label className="field-label">Etiqueta (opcional)</label>
          <input className="field-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Antes do tratamento, sessao 1..." />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 10 }}>
          <div>
            <label className="field-label">Tipo de foto</label>
            <select className="field-input" value={photoType} onChange={event => setPhotoType(event.target.value as PatientPhoto['photo_type'])}>
              <option value="general">Geral</option>
              <option value="before">Antes</option>
              <option value="after">Depois</option>
            </select>
          </div>
          <div>
            <label className="field-label">Vincular a procedimento</label>
            <select className="field-input" value={procedureId} onChange={event => setProcedureId(event.target.value)}>
              <option value="">Sem vinculo</option>
              {procedures.map(procedure => <option key={procedure.id} value={procedure.id}>{fmtProcedure(procedure.performed_at)}</option>)}
            </select>
          </div>
        </div>

        <button className="btn btn--secondary btn--sm" style={{ width: '100%' }} onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <><Upload size={15} /> Enviando...</> : <><Camera size={15} /> Selecionar foto</>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} />
      </div>

      {error ? (
        <div className="empty-state" style={{ padding: '32px 0' }}><p>{error}</p></div>
      ) : loading ? (
        <div className="loading-state">Carregando fotos...</div>
      ) : photos.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 0' }}>
          <Camera size={40} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
          <p>Nenhuma foto registrada.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {beforeAfter.length > 0 && (
            <section>
              <h3 className="section-title">Antes / Depois</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Object.entries(procedureGroups).map(([groupId, groupPhotos]) => (
                  <div key={groupId} className="card" style={{ padding: 12 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-2)', marginBottom: 10 }}>
                      {groupPhotos[0]?.procedure?.performed_at ? `Procedimento ${fmtProcedure(groupPhotos[0].procedure.performed_at)}` : 'Sem procedimento vinculado'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                      {[...groupPhotos].sort((a, b) => a.photo_type.localeCompare(b.photo_type)).map(renderPhotoCard)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {generalPhotos.length > 0 && (
            <section>
              <h3 className="section-title">Geral</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                {generalPhotos.map(renderPhotoCard)}
              </div>
            </section>
          )}
        </div>
      )}

      {preview && (
        <div role="dialog" aria-modal="true" aria-label="Pre-visualizacao da foto" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setPreview(null)}>
          <img src={preview.photo_url} alt={preview.label ?? 'Foto'} style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 8, objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
          {preview.label && <div style={{ color: '#fff', marginTop: 12, fontSize: '0.9rem' }}>{preview.label}</div>}
          <button className="btn btn--ghost btn--sm" aria-label="Fechar pre-visualizacao" style={{ marginTop: 16, color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }} onClick={() => setPreview(null)}>
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
