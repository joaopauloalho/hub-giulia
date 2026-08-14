import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  Loader2,
  PackagePlus,
  Plus,
  Save,
  Trash2,
  Undo2,
  WifiOff,
} from 'lucide-react';
import { InjetaveisFaceMap, type FaceMapPoint } from '../../components/InjetaveisFaceMap';
import { useInjectablesV2 } from '../../hooks/useInjectablesV2';
import type { InjectablePoint, Service } from '../../types';
import {
  applicationTotal,
  isExpiredDate,
  isPositiveQuantity,
  normalizeQuantityInput,
  toLegacyInjectablePoints,
  unitLabel,
  type InjectableApplicationDraftV2,
  type InjectablePointV2,
  type InjectableSaveStatus,
  type InjectableSide,
} from '../../lib/injectablesV2';
import {
  clearAttendanceInjectableDraft,
  clearAttendanceInjectablePoints,
  stageAttendanceInjectableDraft,
  stageAttendanceInjectablePoints,
} from '../../lib/attendanceRuntime';
import './injectables-v2.css';

const COLORS = [
  '#9b59b6', '#3498db', '#e74c3c', '#2e9d78',
  '#d97706', '#0f9f9a', '#c0266d', '#7c3aed',
];

const SIDE_OPTIONS: Array<{ value: InjectableSide | ''; label: string }> = [
  { value: '', label: 'Não informado' },
  { value: 'left', label: 'Esquerdo' },
  { value: 'right', label: 'Direito' },
  { value: 'center', label: 'Centro' },
  { value: 'none', label: 'Sem lado' },
];

interface Props {
  patientId: string;
  injectableServices: Service[];
  onDone: (points: InjectablePoint[]) => void;
  onCancel: () => void;
  onSkip: () => void;
}

function cloneApplications(applications: InjectableApplicationDraftV2[]): InjectableApplicationDraftV2[] {
  return applications.map(application => ({
    ...application,
    points: application.points.map(point => ({ ...point })),
  }));
}

function persistedSnapshot(applications: InjectableApplicationDraftV2[]): InjectableApplicationDraftV2[] {
  return applications.map(application => ({
    ...application,
    points: application.points.filter(point => isPositiveQuantity(point.quantity)).map(point => ({ ...point })),
  }));
}

function statusLabel(status: InjectableSaveStatus) {
  if (status === 'saving') return 'Salvando…';
  if (status === 'saved') return 'Salvo agora';
  if (status === 'offline') return 'Sem conexão';
  if (status === 'error') return 'Erro ao salvar';
  return 'Draft protegido';
}

export function InjetaveisScreen({ patientId, injectableServices, onDone, onCancel, onSkip }: Props) {
  const {
    draft,
    applications,
    setApplications,
    products,
    lots,
    loading,
    error,
    openDraft,
    saveDraft,
    discardDraft,
    createProduct,
    createLot,
  } = useInjectablesV2(patientId);

  const [ready, setReady] = useState(false);
  const [activeApplicationId, setActiveApplicationId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [showQty, setShowQty] = useState(true);
  const [saveStatus, setSaveStatus] = useState<InjectableSaveStatus>('idle');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<InjectableApplicationDraftV2[][]>([]);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const [newServiceId, setNewServiceId] = useState(injectableServices[0]?.id ?? '');
  const [newProductId, setNewProductId] = useState('');
  const [newLotId, setNewLotId] = useState('');
  const [showProductForm, setShowProductForm] = useState(false);
  const [productName, setProductName] = useState('');
  const [productUnit, setProductUnit] = useState('');
  const [productPresentation, setProductPresentation] = useState('');
  const [showLotForm, setShowLotForm] = useState(false);
  const [lotNumber, setLotNumber] = useState('');
  const [lotExpiry, setLotExpiry] = useState('');
  const [catalogSaving, setCatalogSaving] = useState(false);

  const revisionRef = useRef<number>(1);
  const applicationsRef = useRef<InjectableApplicationDraftV2[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const lastQueuedSignatureRef = useRef('');
  const lastSaveFailedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void openDraft()
      .then(map => {
        if (!active) return;
        revisionRef.current = map.revision;
        setReady(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [openDraft]);

  useEffect(() => {
    if (draft) revisionRef.current = draft.revision;
  }, [draft]);

  useEffect(() => {
    applicationsRef.current = applications;
    if (!activeApplicationId && applications.length > 0) {
      setActiveApplicationId(applications[0].id);
    }
    if (activeApplicationId && !applications.some(application => application.id === activeApplicationId)) {
      setActiveApplicationId(applications[0]?.id ?? null);
    }
    if (selectedPointId && !applications.some(application => application.points.some(point => point.id === selectedPointId))) {
      setSelectedPointId(null);
    }
  }, [activeApplicationId, applications, selectedPointId]);

  useEffect(() => {
    if (!newProductId && products.length > 0) {
      const firstActive = products.find(product => product.active) ?? products[0];
      setNewProductId(firstActive?.id ?? '');
    }
  }, [newProductId, products]);

  useEffect(() => {
    const productLots = lots.filter(lot => lot.product_id === newProductId && lot.active);
    if (newLotId && !productLots.some(lot => lot.id === newLotId)) setNewLotId('');
  }, [lots, newLotId, newProductId]);

  const serviceNames = useMemo(
    () => new Map(injectableServices.map(service => [service.id, service.name])),
    [injectableServices],
  );
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const lotById = useMemo(() => new Map(lots.map(lot => [lot.id, lot])), [lots]);
  const productUnits = useMemo(() => new Map(products.map(product => [product.id, product.default_unit])), [products]);

  const activeApplication = applications.find(application => application.id === activeApplicationId) ?? null;
  const selectedPointContext = useMemo(() => {
    for (const application of applications) {
      const point = application.points.find(item => item.id === selectedPointId);
      if (point) return { application, point };
    }
    return null;
  }, [applications, selectedPointId]);

  const facePoints = useMemo<FaceMapPoint[]>(() => applications.flatMap(application => {
    const product = productById.get(application.product_id);
    const serviceName = serviceNames.get(application.service_id) ?? 'Aplicação';
    return application.points.map(point => ({
      id: point.id,
      applicationId: application.id,
      x: point.x,
      y: point.y,
      quantity: point.quantity,
      unit: product?.default_unit ?? '',
      color: application.color,
      label: `${serviceName}${product ? ` · ${product.name}` : ''}`,
      region: point.region,
      side: point.side,
    }));
  }), [applications, productById, serviceNames]);

  const pushUndo = useCallback((snapshot = applicationsRef.current) => {
    const copy = cloneApplications(snapshot);
    setUndoStack(current => [...current.slice(-19), copy]);
  }, []);

  const undo = () => {
    setUndoStack(current => {
      const previous = current.at(-1);
      if (!previous) return current;
      setApplications(cloneApplications(previous));
      return current.slice(0, -1);
    });
  };

  const queuePersist = useCallback((snapshot: InjectableApplicationDraftV2[], force = false) => {
    if (!draft) return saveChainRef.current;
    const persisted = persistedSnapshot(snapshot);
    const signature = JSON.stringify(persisted);

    if (!force && signature === lastQueuedSignatureRef.current && !lastSaveFailedRef.current) {
      return saveChainRef.current;
    }

    if (!navigator.onLine) {
      setSaveStatus('offline');
      setSaveMessage('O estado permanece nesta tela e será sincronizado quando a conexão voltar.');
      lastSaveFailedRef.current = true;
      return saveChainRef.current;
    }

    lastQueuedSignatureRef.current = signature;
    setSaveStatus('saving');
    setSaveMessage(null);

    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const map = await saveDraft(persisted, revisionRef.current);
          revisionRef.current = map.revision;
          lastSaveFailedRef.current = false;
          setSaveStatus('saved');
          setSaveMessage(null);
        } catch (cause) {
          lastSaveFailedRef.current = true;
          setSaveStatus(navigator.onLine ? 'error' : 'offline');
          const message = cause instanceof Error ? cause.message : 'Não foi possível salvar o draft.';
          setSaveMessage(message);
          throw cause;
        }
      });

    return saveChainRef.current;
  }, [draft, saveDraft]);

  useEffect(() => {
    if (!ready || !draft) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void queuePersist(applicationsRef.current);
    }, 800);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [applications, draft, queuePersist, ready]);

  useEffect(() => {
    const handleOnline = () => {
      if (!ready) return;
      void queuePersist(applicationsRef.current, true);
    };
    const handleOffline = () => setSaveStatus('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [queuePersist, ready]);

  const updateApplication = (applicationId: string, updater: (application: InjectableApplicationDraftV2) => InjectableApplicationDraftV2) => {
    setApplications(current => current.map(application => application.id === applicationId ? updater(application) : application));
  };

  const addApplication = () => {
    if (!newServiceId || !newProductId) return;
    pushUndo();
    const application: InjectableApplicationDraftV2 = {
      id: crypto.randomUUID(),
      service_id: newServiceId,
      product_id: newProductId,
      lot_id: newLotId || null,
      color: COLORS[applications.length % COLORS.length],
      dilution_note: '',
      points: [],
    };
    setApplications(current => [...current, application]);
    setActiveApplicationId(application.id);
    setSelectedPointId(null);
  };

  const removeApplication = (applicationId: string) => {
    pushUndo();
    setApplications(current => current.filter(application => application.id !== applicationId));
  };

  const addCoordinate = (x: number, y: number) => {
    if (!activeApplication) return;
    pushUndo();
    const point: InjectablePointV2 = {
      id: crypto.randomUUID(),
      x,
      y,
      quantity: '',
      region: '',
      side: '',
      note: '',
    };
    updateApplication(activeApplication.id, application => ({ ...application, points: [...application.points, point] }));
    setSelectedPointId(point.id);
  };

  const movePoint = (pointId: string, x: number, y: number) => {
    setApplications(current => current.map(application => ({
      ...application,
      points: application.points.map(point => point.id === pointId ? { ...point, x, y } : point),
    })));
  };

  const updateSelectedPoint = (patch: Partial<InjectablePointV2>) => {
    if (!selectedPointContext) return;
    updateApplication(selectedPointContext.application.id, application => ({
      ...application,
      points: application.points.map(point => point.id === selectedPointContext.point.id ? { ...point, ...patch } : point),
    }));
  };

  const deleteSelectedPoint = () => {
    if (!selectedPointContext) return;
    pushUndo();
    updateApplication(selectedPointContext.application.id, application => ({
      ...application,
      points: application.points.filter(point => point.id !== selectedPointContext.point.id),
    }));
    setSelectedPointId(null);
  };

  const createCatalogProduct = async () => {
    if (!productName.trim() || !productUnit.trim()) return;
    setCatalogSaving(true);
    setSaveMessage(null);
    try {
      const product = await createProduct({
        name: productName,
        default_unit: productUnit,
        presentation: productPresentation,
      });
      setNewProductId(product.id);
      setProductName('');
      setProductUnit('');
      setProductPresentation('');
      setShowProductForm(false);
    } catch (cause) {
      setSaveMessage(cause instanceof Error ? cause.message : 'Não foi possível criar o produto.');
    } finally {
      setCatalogSaving(false);
    }
  };

  const createCatalogLot = async () => {
    if (!newProductId || !lotNumber.trim()) return;
    setCatalogSaving(true);
    setSaveMessage(null);
    try {
      const lot = await createLot({ product_id: newProductId, lot_number: lotNumber, expires_on: lotExpiry });
      setNewLotId(lot.id);
      setLotNumber('');
      setLotExpiry('');
      setShowLotForm(false);
    } catch (cause) {
      setSaveMessage(cause instanceof Error ? cause.message : 'Não foi possível criar o lote.');
    } finally {
      setCatalogSaving(false);
    }
  };

  const currentProductLots = lots.filter(lot => lot.product_id === newProductId && (lot.active || lot.id === newLotId));
  const activeLot = activeApplication?.lot_id ? lotById.get(activeApplication.lot_id) : null;
  const activeProduct = activeApplication ? productById.get(activeApplication.product_id) : null;

  const invalidPointCount = applications.reduce(
    (count, application) => count + application.points.filter(point => !isPositiveQuantity(point.quantity)).length,
    0,
  );
  const totalPointCount = applications.reduce((count, application) => count + application.points.length, 0);
  const canFinish = applications.length > 0
    && applications.every(application => application.points.length > 0)
    && invalidPointCount === 0
    && saveStatus !== 'offline';

  const finish = async () => {
    if (!draft || !canFinish) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    try {
      await queuePersist(applicationsRef.current, true);
      const points = toLegacyInjectablePoints(applicationsRef.current, serviceNames, productUnits);
      stageAttendanceInjectableDraft({ mapId: draft.id, revision: revisionRef.current });
      stageAttendanceInjectablePoints(points);
      onDone(points);
    } catch {
      setSaveStatus(navigator.onLine ? 'error' : 'offline');
    }
  };

  const goBack = () => {
    clearAttendanceInjectableDraft();
    clearAttendanceInjectablePoints();
    onCancel();
  };

  const skip = async () => {
    if (!confirmSkip && (applications.length > 0 || totalPointCount > 0)) {
      setConfirmSkip(true);
      return;
    }
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    try {
      await saveChainRef.current.catch(() => undefined);
      await discardDraft(revisionRef.current);
      clearAttendanceInjectableDraft();
      clearAttendanceInjectablePoints();
      onSkip();
    } catch (cause) {
      setSaveStatus('error');
      setSaveMessage(cause instanceof Error ? cause.message : 'Não foi possível descartar o draft.');
    }
  };

  if (loading || !ready) {
    return (
      <div className="injectables-editor-overlay" role="dialog" aria-modal="true" aria-label="Mapa de injetáveis">
        <div className="injectables-loading"><Loader2 className="spin" size={28} /> Carregando registro clínico…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="injectables-editor-overlay" role="dialog" aria-modal="true" aria-label="Mapa de injetáveis">
        <div className="injectables-error-card">
          <strong>Não foi possível abrir Injetáveis 2.0</strong>
          <span>{error}</span>
          <button className="btn btn--secondary btn--md" onClick={goBack}>Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="injectables-editor-overlay" role="dialog" aria-modal="true" aria-label="Mapa de Injetáveis">
      <section className="injectables-editor-shell">
        <header className="injectables-editor-header">
          <button className="injectables-icon-button" onClick={goBack} aria-label="Voltar e manter draft">
            <ChevronLeft size={22} />
          </button>
          <div className="injectables-header-copy">
            <strong>Injetáveis 2.0</strong>
            <span>Registro do que foi aplicado · mapa facial</span>
          </div>
          <div className={`injectables-save-state injectables-save-state--${saveStatus}`}>
            {saveStatus === 'saving' ? <Loader2 className="spin" size={15} /> : saveStatus === 'offline' ? <WifiOff size={15} /> : <Save size={15} />}
            {statusLabel(saveStatus)}
          </div>
          <button className="injectables-icon-button" onClick={() => setShowQty(value => !value)} aria-label={showQty ? 'Ocultar quantidades' : 'Mostrar quantidades'}>
            {showQty ? <Eye size={19} /> : <EyeOff size={19} />}
          </button>
          <button className="injectables-icon-button" onClick={undo} disabled={undoStack.length === 0} aria-label="Desfazer última alteração">
            <Undo2 size={19} />
          </button>
        </header>

        <div className="injectables-editor-grid">
          <aside className="injectables-panel injectables-applications-panel">
            <div className="injectables-panel-heading">
              <div><strong>Aplicações</strong><span>Produto, lote e total ficam separados.</span></div>
            </div>

            <div className="injectables-application-list">
              {applications.length === 0 && (
                <div className="injectables-empty-mini">Adicione a primeira aplicação para começar a marcar o mapa.</div>
              )}
              {applications.map(application => {
                const product = productById.get(application.product_id);
                const lot = application.lot_id ? lotById.get(application.lot_id) : null;
                const active = application.id === activeApplicationId;
                return (
                  <button
                    type="button"
                    key={application.id}
                    className={`injectables-application-card${active ? ' is-active' : ''}`}
                    onClick={() => { setActiveApplicationId(application.id); setSelectedPointId(null); }}
                  >
                    <span className="injectables-color-dot" style={{ background: application.color }} />
                    <span className="injectables-application-main">
                      <strong>{product?.name ?? 'Produto indisponível'}</strong>
                      <span>{serviceNames.get(application.service_id) ?? 'Serviço'}{lot ? ` · lote ${lot.lot_number}` : ''}</span>
                    </span>
                    <span className="injectables-application-total">
                      {applicationTotal(application)} {unitLabel(product?.default_unit)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="injectables-form-block">
              <label>Serviço injetável</label>
              <select value={newServiceId} onChange={event => setNewServiceId(event.target.value)}>
                {injectableServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>

              <label>Produto / substância</label>
              <div className="injectables-inline-field">
                <select value={newProductId} onChange={event => { setNewProductId(event.target.value); setNewLotId(''); }}>
                  <option value="">Selecione</option>
                  {products.map(product => (
                    <option key={product.id} value={product.id} disabled={!product.active}>
                      {product.name} · {product.default_unit}{!product.active ? ' (inativo)' : ''}
                    </option>
                  ))}
                </select>
                <button className="injectables-mini-button" onClick={() => setShowProductForm(value => !value)} aria-label="Novo produto"><PackagePlus size={17} /></button>
              </div>

              {showProductForm && (
                <div className="injectables-subform">
                  <input value={productName} onChange={event => setProductName(event.target.value)} placeholder="Nome do produto" />
                  <input value={productUnit} onChange={event => setProductUnit(event.target.value)} placeholder="Unidade (ex.: U, mL, mg)" />
                  <input value={productPresentation} onChange={event => setProductPresentation(event.target.value)} placeholder="Apresentação (opcional)" />
                  <button className="btn btn--primary btn--sm" onClick={() => void createCatalogProduct()} disabled={catalogSaving || !productName.trim() || !productUnit.trim()}>
                    Criar produto
                  </button>
                </div>
              )}

              <label>Lote (opcional)</label>
              <div className="injectables-inline-field">
                <select value={newLotId} onChange={event => setNewLotId(event.target.value)} disabled={!newProductId}>
                  <option value="">Sem lote informado</option>
                  {currentProductLots.map(lot => (
                    <option key={lot.id} value={lot.id}>
                      {lot.lot_number}{lot.expires_on ? ` · val. ${lot.expires_on.split('-').reverse().join('/')}` : ''}{isExpiredDate(lot.expires_on) ? ' · VENCIDO' : ''}
                    </option>
                  ))}
                </select>
                <button className="injectables-mini-button" onClick={() => setShowLotForm(value => !value)} disabled={!newProductId} aria-label="Novo lote"><Plus size={17} /></button>
              </div>

              {showLotForm && newProductId && (
                <div className="injectables-subform">
                  <input value={lotNumber} onChange={event => setLotNumber(event.target.value)} placeholder="Número do lote" />
                  <input type="date" value={lotExpiry} onChange={event => setLotExpiry(event.target.value)} />
                  <button className="btn btn--primary btn--sm" onClick={() => void createCatalogLot()} disabled={catalogSaving || !lotNumber.trim()}>
                    Criar lote
                  </button>
                </div>
              )}

              <button className="btn btn--primary btn--md w-full" onClick={addApplication} disabled={!newServiceId || !newProductId}>
                <Plus size={17} /> Adicionar aplicação
              </button>
            </div>

            {activeApplication && (
              <div className="injectables-active-meta">
                <div>
                  <span>Unidade histórica ao finalizar</span>
                  <strong>{unitLabel(activeProduct?.default_unit)}</strong>
                </div>
                {activeLot && (
                  <div className={isExpiredDate(activeLot.expires_on) ? 'is-expired' : ''}>
                    <span>Lote / validade</span>
                    <strong>{activeLot.lot_number}{activeLot.expires_on ? ` · ${activeLot.expires_on.split('-').reverse().join('/')}` : ''}</strong>
                    {isExpiredDate(activeLot.expires_on) && <em>Lote vencido</em>}
                  </div>
                )}
                <label>Observação de diluição (opcional)</label>
                <input
                  value={activeApplication.dilution_note}
                  onChange={event => updateApplication(activeApplication.id, application => ({ ...application, dilution_note: event.target.value }))}
                  placeholder="Somente registro do que foi feito"
                />
                <button className="injectables-text-danger" onClick={() => removeApplication(activeApplication.id)}>
                  <Trash2 size={15} /> Remover aplicação
                </button>
              </div>
            )}
          </aside>

          <main className="injectables-map-panel">
            <div className="injectables-map-toolbar">
              <div>
                <strong>{activeProduct?.name ?? 'Selecione uma aplicação'}</strong>
                <span>{activeApplication ? `${applicationTotal(activeApplication)} ${unitLabel(activeProduct?.default_unit)} · ${activeApplication.points.length} ponto${activeApplication.points.length === 1 ? '' : 's'}` : 'Adicione uma aplicação no painel esquerdo.'}</span>
              </div>
              <span className="injectables-map-hint">Toque para adicionar · arraste para mover</span>
            </div>
            <div className="injectables-map-stage">
              <InjetaveisFaceMap
                points={facePoints}
                activeApplicationId={activeApplicationId}
                activeColor={activeApplication?.color ?? 'var(--primary)'}
                selectedPointId={selectedPointId}
                showQuantities={showQty}
                onAddCoordinate={addCoordinate}
                onSelectPoint={setSelectedPointId}
                onMoveStart={() => pushUndo()}
                onMovePoint={movePoint}
              />
            </div>
            <div className="injectables-map-legend">
              {applications.map(application => {
                const product = productById.get(application.product_id);
                return (
                  <span key={application.id}><i style={{ background: application.color }} />{product?.name ?? 'Produto'} · {applicationTotal(application)} {unitLabel(product?.default_unit)}</span>
                );
              })}
            </div>
          </main>

          <aside className="injectables-panel injectables-point-panel">
            <div className="injectables-panel-heading">
              <div><strong>Ponto selecionado</strong><span>Quantidade, região e observação.</span></div>
            </div>

            {!selectedPointContext ? (
              <div className="injectables-empty-point">Selecione um ponto no rosto ou toque no mapa para criar um novo.</div>
            ) : (() => {
              const { application, point } = selectedPointContext;
              const product = productById.get(application.product_id);
              const serviceName = serviceNames.get(application.service_id) ?? 'Aplicação';
              return (
                <div className="injectables-point-form">
                  <div className="injectables-point-context">
                    <span className="injectables-color-dot" style={{ background: application.color }} />
                    <div><strong>{product?.name ?? 'Produto'}</strong><span>{serviceName}</span></div>
                  </div>

                  <label>Quantidade aplicada neste ponto</label>
                  <div className="injectables-quantity-field">
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={point.quantity}
                      onChange={event => updateSelectedPoint({ quantity: normalizeQuantityInput(event.target.value) })}
                      placeholder="0"
                      aria-invalid={!isPositiveQuantity(point.quantity)}
                    />
                    <strong>{unitLabel(product?.default_unit)}</strong>
                  </div>
                  {!isPositiveQuantity(point.quantity) && <small className="injectables-field-warning">Informe uma quantidade maior que zero.</small>}

                  <label>Região (opcional)</label>
                  <input value={point.region} onChange={event => updateSelectedPoint({ region: event.target.value })} placeholder="Ex.: glabela, frontal, lábio" />

                  <label>Lado (opcional)</label>
                  <select value={point.side} onChange={event => updateSelectedPoint({ side: event.target.value as InjectableSide | '' })}>
                    {SIDE_OPTIONS.map(option => <option key={option.value || 'empty'} value={option.value}>{option.label}</option>)}
                  </select>

                  <label>Observação do ponto (opcional)</label>
                  <textarea value={point.note} onChange={event => updateSelectedPoint({ note: event.target.value })} rows={3} placeholder="Registro curto" />

                  <div className="injectables-coordinate-readout">
                    Posição relativa: {(point.x * 100).toFixed(1)}% · {(point.y * 100).toFixed(1)}%
                  </div>

                  <button className="btn btn--danger btn--md w-full" onClick={deleteSelectedPoint}>
                    <Trash2 size={16} /> Excluir ponto
                  </button>
                </div>
              );
            })()}
          </aside>
        </div>

        {(saveMessage || invalidPointCount > 0 || confirmSkip) && (
          <div className="injectables-notice-bar">
            {confirmSkip ? (
              <span><strong>Descartar este mapa?</strong> Isso remove apenas o draft atual; nenhum atendimento será criado.</span>
            ) : saveMessage ? (
              <span>{saveMessage}</span>
            ) : (
              <span>Há {invalidPointCount} ponto{invalidPointCount === 1 ? '' : 's'} sem quantidade válida.</span>
            )}
          </div>
        )}

        <footer className="injectables-editor-footer">
          {confirmSkip ? (
            <>
              <button className="btn btn--ghost btn--md" onClick={() => setConfirmSkip(false)}>Manter draft</button>
              <button className="btn btn--danger btn--md" onClick={() => void skip()}>Descartar e pular</button>
            </>
          ) : (
            <>
              <button className="btn btn--ghost btn--md" onClick={goBack}>Voltar</button>
              <button className="btn btn--ghost btn--md" onClick={() => void skip()}>Pular mapa</button>
              <div className="injectables-footer-summary">
                {applications.length} aplicação{applications.length === 1 ? '' : 'ões'} · {totalPointCount} ponto{totalPointCount === 1 ? '' : 's'}
              </div>
              <button className="btn btn--primary btn--md injectables-finish-button" onClick={() => void finish()} disabled={!canFinish || saveStatus === 'saving'}>
                {saveStatus === 'saving' ? <Loader2 className="spin" size={17} /> : <Check size={17} />}
                Concluir mapa
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
