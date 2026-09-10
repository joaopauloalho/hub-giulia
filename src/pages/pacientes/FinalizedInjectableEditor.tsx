import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { InjetaveisFaceMap, type FaceMapPoint } from '../../components/InjetaveisFaceMap';
import { supabase } from '../../lib/supabase';
import {
  applicationTotal,
  formatQuantity,
  isPositiveQuantity,
  normalizeQuantityInput,
  unitLabel,
  type InjectableApplicationDraftV2,
  type InjectableLotV2,
  type InjectablePointV2,
  type InjectableProductV2,
  type InjectableSide,
} from '../../lib/injectablesV2';
import { brazilianDateToIso, normalizeBrazilianDateInput } from '../../lib/dateInput';
import '../registrar/injectables-v2.css';

type ServiceOption = { id: string; name: string; is_injectable: boolean };
type EditableMap = {
  id: string;
  patient_id: string;
  revision: number;
  procedure_summary: string | null;
};
type ApplicationRow = {
  id: string;
  map_id: string;
  service_id: string;
  product_id: string;
  lot_id: string | null;
  color_snapshot: string;
  dilution_note: string | null;
  label_photo_path: string | null;
  created_at: string;
};
type PointRow = {
  id: string;
  application_id: string;
  x: string | number;
  y: string | number;
  quantity: string | number;
  region: string | null;
  side: InjectableSide | null;
  note: string | null;
  created_at: string;
};
type LotWithPhoto = InjectableLotV2 & { label_photo_path?: string | null };
type ApplicationWithPhoto = InjectableApplicationDraftV2 & { label_photo_path?: string | null };

const COLORS = ['#9b59b6', '#3498db', '#e74c3c', '#2e9d78', '#d97706', '#0f9f9a', '#c0266d', '#7c3aed'];
const SIDES: Array<{ value: InjectableSide | ''; label: string }> = [
  { value: '', label: 'Não informado' },
  { value: 'left', label: 'Esquerdo' },
  { value: 'right', label: 'Direito' },
  { value: 'center', label: 'Centro' },
  { value: 'none', label: 'Sem lado' },
];

interface Props {
  mapId: string;
  patientId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function FinalizedInjectableEditor({ mapId, patientId, onClose, onSaved }: Props) {
  const [map, setMap] = useState<EditableMap | null>(null);
  const [applications, setApplications] = useState<ApplicationWithPhoto[]>([]);
  const [products, setProducts] = useState<InjectableProductV2[]>([]);
  const [lots, setLots] = useState<LotWithPhoto[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [activeApplicationId, setActiveApplicationId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newServiceId, setNewServiceId] = useState('');
  const [newProductId, setNewProductId] = useState('');
  const [newLotId, setNewLotId] = useState('');
  const [newLotNumber, setNewLotNumber] = useState('');
  const [newLotExpiry, setNewLotExpiry] = useState('');
  const [showNewLot, setShowNewLot] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const [mapResult, appResult, pointResult, productResult, lotResult, serviceResult] = await Promise.all([
          supabase.from('injectable_maps').select('id,patient_id,revision,procedure_summary,status,source_type').eq('id', mapId).eq('patient_id', patientId).single(),
          supabase.from('injectable_applications').select('id,map_id,service_id,product_id,lot_id,color_snapshot,dilution_note,label_photo_path,created_at').eq('map_id', mapId).order('created_at'),
          supabase.from('injectable_application_points').select('id,application_id,x,y,quantity,region,side,note,created_at').eq('map_id', mapId).order('created_at'),
          supabase.from('injectable_products').select('*').order('active', { ascending: false }).order('name'),
          supabase.from('injectable_product_lots').select('*').order('active', { ascending: false }).order('expires_on', { ascending: true, nullsFirst: false }),
          supabase.from('services').select('id,name,is_injectable').eq('is_injectable', true).order('name'),
        ]);
        for (const result of [mapResult, appResult, pointResult, productResult, lotResult, serviceResult]) {
          if (result.error) throw result.error;
        }
        const rawMap = mapResult.data as EditableMap & { status: string; source_type: string };
        if (rawMap.status !== 'finalized' || rawMap.source_type !== 'v2') throw new Error('Este registro não pode ser editado por este editor.');
        const pointRows = (pointResult.data ?? []) as PointRow[];
        const byApp = new Map<string, InjectablePointV2[]>();
        pointRows.forEach(point => {
          const current = byApp.get(point.application_id) ?? [];
          current.push({ id: point.id, x: Number(point.x), y: Number(point.y), quantity: formatQuantity(point.quantity), region: point.region ?? '', side: point.side ?? '', note: point.note ?? '' });
          byApp.set(point.application_id, current);
        });
        const restored = ((appResult.data ?? []) as ApplicationRow[]).map(app => ({
          id: app.id,
          service_id: app.service_id,
          product_id: app.product_id,
          lot_id: app.lot_id,
          color: app.color_snapshot,
          dilution_note: app.dilution_note ?? '',
          label_photo_path: app.label_photo_path,
          points: byApp.get(app.id) ?? [],
        }));
        if (!alive) return;
        setMap(rawMap);
        setSummary(rawMap.procedure_summary ?? '');
        setApplications(restored);
        setProducts((productResult.data ?? []) as InjectableProductV2[]);
        setLots((lotResult.data ?? []) as LotWithPhoto[]);
        setServices((serviceResult.data ?? []) as ServiceOption[]);
        setActiveApplicationId(restored[0]?.id ?? null);
        setNewServiceId(((serviceResult.data ?? []) as ServiceOption[])[0]?.id ?? '');
        setNewProductId(((productResult.data ?? []) as InjectableProductV2[]).find(product => product.active)?.id ?? '');
      } catch (error) {
        if (alive) setMessage(error instanceof Error ? error.message : 'Não foi possível abrir o registro.');
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => { alive = false; };
  }, [mapId, patientId]);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const lotById = useMemo(() => new Map(lots.map(lot => [lot.id, lot])), [lots]);
  const serviceById = useMemo(() => new Map(services.map(service => [service.id, service])), [services]);
  const activeApplication = applications.find(application => application.id === activeApplicationId) ?? null;
  const selectedPoint = useMemo(() => {
    for (const application of applications) {
      const point = application.points.find(item => item.id === selectedPointId);
      if (point) return { application, point };
    }
    return null;
  }, [applications, selectedPointId]);
  const activeProduct = activeApplication ? productById.get(activeApplication.product_id) : null;
  const activeLot = activeApplication?.lot_id ? lotById.get(activeApplication.lot_id) : null;

  useEffect(() => {
    let alive = true;
    setPhotoUrl(null);
    const path = activeLot?.label_photo_path ?? activeApplication?.label_photo_path ?? null;
    if (!path) return () => { alive = false; };
    void supabase.storage.from('injectable-labels').createSignedUrl(path, 3600).then(({ data }) => {
      if (alive) setPhotoUrl(data?.signedUrl ?? null);
    });
    return () => { alive = false; };
  }, [activeApplication?.label_photo_path, activeLot?.label_photo_path]);

  const setApplication = (id: string, updater: (application: ApplicationWithPhoto) => ApplicationWithPhoto) => {
    setApplications(current => current.map(application => application.id === id ? updater(application) : application));
  };

  const facePoints = useMemo<FaceMapPoint[]>(() => applications.flatMap(application => {
    const product = productById.get(application.product_id);
    return application.points.map(point => ({
      id: point.id,
      applicationId: application.id,
      x: point.x,
      y: point.y,
      quantity: point.quantity,
      unit: product?.default_unit ?? '',
      color: application.color,
      label: `${serviceById.get(application.service_id)?.name ?? 'Aplicação'}${product ? ` · ${product.name}` : ''}`,
      region: point.region,
      side: point.side,
    }));
  }), [applications, productById, serviceById]);

  const addPoint = (x: number, y: number) => {
    if (!activeApplication) return;
    const point: InjectablePointV2 = { id: crypto.randomUUID(), x, y, quantity: '', region: '', side: '', note: '' };
    setApplication(activeApplication.id, app => ({ ...app, points: [...app.points, point] }));
    setSelectedPointId(point.id);
  };

  const movePoint = (id: string, x: number, y: number) => {
    setApplications(current => current.map(application => ({ ...application, points: application.points.map(point => point.id === id ? { ...point, x, y } : point) })));
  };

  const updatePoint = (patch: Partial<InjectablePointV2>) => {
    if (!selectedPoint) return;
    setApplication(selectedPoint.application.id, application => ({
      ...application,
      points: application.points.map(point => point.id === selectedPoint.point.id ? { ...point, ...patch } : point),
    }));
  };

  const addApplication = () => {
    if (!newServiceId || !newProductId) return;
    const application: ApplicationWithPhoto = {
      id: crypto.randomUUID(), service_id: newServiceId, product_id: newProductId, lot_id: newLotId || null,
      color: COLORS[applications.length % COLORS.length], dilution_note: '', points: [],
      label_photo_path: newLotId ? lotById.get(newLotId)?.label_photo_path ?? null : null,
    };
    setApplications(current => [...current, application]);
    setActiveApplicationId(application.id);
    setSelectedPointId(null);
  };

  const createLot = async () => {
    if (!newProductId || !newLotNumber.trim()) return;
    const expiresOn = newLotExpiry.trim() ? brazilianDateToIso(newLotExpiry) : null;
    if (newLotExpiry.trim() && !expiresOn) { setMessage('Validade inválida. Use DD/MM/AAAA.'); return; }
    const { data, error } = await supabase.from('injectable_product_lots').insert({ product_id: newProductId, lot_number: newLotNumber.trim(), expires_on: expiresOn }).select('*').single();
    if (error) { setMessage(error.message); return; }
    const lot = data as LotWithPhoto;
    setLots(current => [...current, lot]);
    setNewLotId(lot.id);
    setNewLotNumber('');
    setNewLotExpiry('');
    setShowNewLot(false);
  };

  const uploadLabel = async (file: File) => {
    if (!activeLot || !activeApplication) { setMessage('Selecione um lote antes de adicionar a etiqueta.'); return; }
    setPhotoUploading(true);
    setMessage(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error('Sessão expirada.');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${auth.user.id}/${mapId}/${activeLot.id}/${crypto.randomUUID()}.${ext}`;
      const upload = await supabase.storage.from('injectable-labels').upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upload.error) throw upload.error;
      const update = await supabase.from('injectable_product_lots').update({ label_photo_path: path }).eq('id', activeLot.id);
      if (update.error) throw update.error;
      setLots(current => current.map(lot => lot.id === activeLot.id ? { ...lot, label_photo_path: path } : lot));
      setApplication(activeApplication.id, app => ({ ...app, label_photo_path: path }));
      const signed = await supabase.storage.from('injectable-labels').createSignedUrl(path, 3600);
      setPhotoUrl(signed.data?.signedUrl ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível enviar a foto.');
    } finally {
      setPhotoUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLabel = async () => {
    if (!activeLot || !activeApplication) return;
    const path = activeLot.label_photo_path ?? activeApplication.label_photo_path ?? null;
    setPhotoUploading(true);
    try {
      if (path) await supabase.storage.from('injectable-labels').remove([path]);
      const update = await supabase.from('injectable_product_lots').update({ label_photo_path: null }).eq('id', activeLot.id);
      if (update.error) throw update.error;
      setLots(current => current.map(lot => lot.id === activeLot.id ? { ...lot, label_photo_path: null } : lot));
      setApplication(activeApplication.id, app => ({ ...app, label_photo_path: null }));
      setPhotoUrl(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível remover a foto.');
    } finally { setPhotoUploading(false); }
  };

  const save = async () => {
    if (!map) return;
    const invalid = applications.some(application => application.points.length === 0 || application.points.some(point => !isPositiveQuantity(point.quantity)));
    if (applications.length === 0 || invalid) {
      setMessage('Cada aplicação precisa ter pelo menos um ponto com quantidade maior que zero.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = applications.map(application => ({
        id: application.id,
        service_id: application.service_id,
        product_id: application.product_id,
        lot_id: application.lot_id,
        color: application.color,
        dilution_note: application.dilution_note || null,
        label_photo_path: application.lot_id ? lotById.get(application.lot_id)?.label_photo_path ?? application.label_photo_path ?? null : null,
        points: application.points.map(point => ({ id: point.id, x: point.x, y: point.y, quantity: point.quantity, region: point.region || null, side: point.side || null, note: point.note || null })),
      }));
      const { data, error } = await supabase.rpc('save_finalized_injectable_record_v2', {
        p_map_id: map.id,
        p_expected_revision: map.revision,
        p_applications: payload,
        p_procedure_summary: summary.trim() || null,
      });
      if (error) throw error;
      setMap(data as EditableMap);
      onSaved();
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível salvar as alterações.');
    } finally { setSaving(false); }
  };

  const availableLots = lots.filter(lot => lot.product_id === newProductId && lot.active);

  return (
    <div className="injectables-editor-overlay" role="dialog" aria-modal="true" aria-label="Editar registro de injetáveis">
      <section className="injectables-editor-shell">
        <header className="injectables-editor-header">
          <button className="injectables-icon-button" onClick={onClose} aria-label="Fechar"><X size={21} /></button>
          <div className="injectables-header-copy"><strong>Editar injetáveis</strong><span>Registro interno · você pode completar depois sem criar outro</span></div>
          <button className="btn btn--primary btn--md" onClick={() => void save()} disabled={saving || loading}>{saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />} Salvar</button>
        </header>

        {loading ? <div className="injectables-loading"><Loader2 className="spin" size={28} /> Carregando registro…</div> : (
          <div className="injectables-editor-grid">
            <aside className="injectables-panel injectables-applications-panel">
              <div className="injectables-panel-heading"><div><strong>Aplicações</strong><span>Produto, lote e etiqueta.</span></div></div>
              <div className="injectables-application-list">
                {applications.map(application => {
                  const product = productById.get(application.product_id);
                  const lot = application.lot_id ? lotById.get(application.lot_id) : null;
                  return <button type="button" key={application.id} className={`injectables-application-card${application.id === activeApplicationId ? ' is-active' : ''}`} onClick={() => { setActiveApplicationId(application.id); setSelectedPointId(null); }}>
                    <span className="injectables-color-dot" style={{ background: application.color }} />
                    <span className="injectables-application-main"><strong>{product?.name ?? 'Produto'}</strong><span>{serviceById.get(application.service_id)?.name ?? 'Serviço'}{lot ? ` · lote ${lot.lot_number}` : ''}</span></span>
                    <span className="injectables-application-total">{applicationTotal(application)} {unitLabel(product?.default_unit)}</span>
                  </button>;
                })}
              </div>

              <div className="injectables-form-block">
                <label>Serviço</label>
                <select value={newServiceId} onChange={event => setNewServiceId(event.target.value)}>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select>
                <label>Produto</label>
                <select value={newProductId} onChange={event => { setNewProductId(event.target.value); setNewLotId(''); }}>{products.filter(product => product.active).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
                <label>Lote / validade (opcional)</label>
                <div className="injectables-inline-field">
                  <select value={newLotId} onChange={event => setNewLotId(event.target.value)}><option value="">Sem lote</option>{availableLots.map(lot => <option key={lot.id} value={lot.id}>{lot.lot_number}{lot.expires_on ? ` · ${lot.expires_on.split('-').reverse().join('/')}` : ''}</option>)}</select>
                  <button className="injectables-mini-button" onClick={() => setShowNewLot(value => !value)} aria-label="Novo lote"><Plus size={17} /></button>
                </div>
                {showNewLot && <div className="injectables-subform">
                  <input value={newLotNumber} onChange={event => setNewLotNumber(event.target.value)} placeholder="Número do lote" />
                  <input value={newLotExpiry} inputMode="numeric" onChange={event => setNewLotExpiry(normalizeBrazilianDateInput(event.target.value))} placeholder="Validade DD/MM/AAAA" maxLength={10} />
                  <button className="btn btn--primary btn--sm" onClick={() => void createLot()} disabled={!newLotNumber.trim()}>Criar lote</button>
                </div>}
                <button className="btn btn--primary btn--md w-full" onClick={addApplication} disabled={!newServiceId || !newProductId}><Plus size={17} /> Adicionar aplicação</button>
              </div>

              {activeApplication && <div className="injectables-active-meta">
                {activeLot && <div><span>Lote / validade</span><strong>{activeLot.lot_number}{activeLot.expires_on ? ` · ${activeLot.expires_on.split('-').reverse().join('/')}` : ''}</strong></div>}
                {activeLot && <div>
                  <span>Foto da etiqueta (opcional)</span>
                  {photoUrl && <img src={photoUrl} alt="Etiqueta do produto" style={{ width: '100%', maxHeight: 150, objectFit: 'contain', borderRadius: 10, marginTop: 6, background: '#fff' }} />}
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadLabel(file); }} />
                  <button className="btn btn--secondary btn--sm w-full" onClick={() => fileRef.current?.click()} disabled={photoUploading}>{photoUploading ? <Loader2 className="spin" size={15} /> : <ImagePlus size={15} />} {photoUrl ? 'Trocar foto da etiqueta' : 'Adicionar foto da etiqueta'}</button>
                  {photoUrl && <button className="injectables-text-danger" onClick={() => void removeLabel()} disabled={photoUploading}><Trash2 size={14} /> Remover foto</button>}
                </div>}
                <label>Observação de diluição (opcional)</label>
                <input value={activeApplication.dilution_note} onChange={event => setApplication(activeApplication.id, app => ({ ...app, dilution_note: event.target.value }))} />
                <button className="injectables-text-danger" onClick={() => { setApplications(current => current.filter(app => app.id !== activeApplication.id)); setActiveApplicationId(null); setSelectedPointId(null); }}><Trash2 size={15} /> Remover aplicação</button>
              </div>}
            </aside>

            <main className="injectables-map-panel">
              <div className="injectables-map-toolbar"><div><strong>{activeProduct?.name ?? 'Selecione uma aplicação'}</strong><span>Toque para adicionar · arraste para mover</span></div></div>
              <div className="injectables-map-stage"><InjetaveisFaceMap points={facePoints} activeApplicationId={activeApplicationId} activeColor={activeApplication?.color ?? 'var(--primary)'} selectedPointId={selectedPointId} showQuantities onAddCoordinate={addPoint} onSelectPoint={setSelectedPointId} onMoveStart={() => undefined} onMovePoint={movePoint} /></div>
              <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
                <label style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>Resumo do procedimento <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(opcional)</span></label>
                <textarea value={summary} onChange={event => setSummary(event.target.value)} rows={4} placeholder="Ex.: anestesia utilizada, técnica, tolerância da paciente, intercorrências e observações para o próximo atendimento." style={{ width: '100%', resize: 'vertical' }} />
              </div>
            </main>

            <aside className="injectables-panel injectables-point-panel">
              <div className="injectables-panel-heading"><div><strong>Ponto selecionado</strong><span>Complete somente o que fizer sentido.</span></div></div>
              {!selectedPoint ? <div className="injectables-empty-point">Selecione um ponto no rosto ou toque no mapa para adicionar.</div> : <div className="injectables-point-form">
                <label>Quantidade aplicada</label>
                <div className="injectables-quantity-field"><input autoFocus inputMode="decimal" value={selectedPoint.point.quantity} onChange={event => updatePoint({ quantity: normalizeQuantityInput(event.target.value) })} /><strong>{unitLabel(productById.get(selectedPoint.application.product_id)?.default_unit)}</strong></div>
                <label>Região (opcional)</label><input value={selectedPoint.point.region} onChange={event => updatePoint({ region: event.target.value })} />
                <label>Lado (opcional)</label><select value={selectedPoint.point.side} onChange={event => updatePoint({ side: event.target.value as InjectableSide | '' })}>{SIDES.map(option => <option key={option.value || 'empty'} value={option.value}>{option.label}</option>)}</select>
                <label>Observação (opcional)</label><textarea rows={3} value={selectedPoint.point.note} onChange={event => updatePoint({ note: event.target.value })} />
                <button className="btn btn--danger btn--md w-full" onClick={() => { setApplication(selectedPoint.application.id, app => ({ ...app, points: app.points.filter(point => point.id !== selectedPoint.point.id) })); setSelectedPointId(null); }}><Trash2 size={16} /> Excluir ponto</button>
              </div>}
            </aside>
          </div>
        )}

        {message && <div className="injectables-notice-bar"><span>{message}</span></div>}
        <footer className="injectables-editor-footer"><div className="injectables-footer-summary">Registro interno · alterações ficam no mesmo registro</div><button className="btn btn--ghost btn--md" onClick={onClose}>Cancelar</button><button className="btn btn--primary btn--md" onClick={() => void save()} disabled={saving || loading}>{saving ? <Loader2 className="spin" size={17} /> : <Check size={17} />} Salvar alterações</button></footer>
      </section>
    </div>
  );
}
