import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Expand, Minus, Plus, Share2, X } from 'lucide-react';
import { PHOTO_ANGLE_LABELS, exportSideBySideComparison, isSamePhotoComparison, pairSessionPhotos } from '../../lib/clinicalPhotos';
import type { PatientPhotoSession } from '../../hooks/usePatientPhotos';

type ComparisonMode = 'side' | 'slider' | 'overlay';
type Side = 'before' | 'after';

interface TransformState { zoom: number; x: number; y: number }

interface PhotoComparisonProps {
  beforeSession: PatientPhotoSession;
  afterSession: PatientPhotoSession;
  previewUrls: Map<string, string | null>;
  onClose: () => void;
}

const INITIAL_TRANSFORM: TransformState = { zoom: 1, x: 0, y: 0 };

function displayDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
}

export default function PhotoComparison({ beforeSession, afterSession, previewUrls, onClose }: PhotoComparisonProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const pairs = useMemo(() => pairSessionPhotos(beforeSession.photos, afterSession.photos), [afterSession.photos, beforeSession.photos]);
  const [pairIndex, setPairIndex] = useState(0);
  const [mode, setMode] = useState<ComparisonMode>('side');
  const [slider, setSlider] = useState(50);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [sync, setSync] = useState(true);
  const [activeSide, setActiveSide] = useState<Side>('after');
  const [beforeTransform, setBeforeTransform] = useState<TransformState>(INITIAL_TRANSFORM);
  const [afterTransform, setAfterTransform] = useState<TransformState>(INITIAL_TRANSFORM);
  const [exporting, setExporting] = useState(false);

  const pair = pairs[pairIndex] ?? null;
  const beforeUrl = pair?.before ? previewUrls.get(pair.before.id) ?? null : null;
  const afterUrl = pair?.after ? previewUrls.get(pair.after.id) ?? null : null;
  const comparable = Boolean(pair?.before && pair?.after && beforeUrl && afterUrl && !isSamePhotoComparison(pair.before.id, pair.after.id));

  const changeTransform = (mutate: (current: TransformState) => TransformState) => {
    if (sync) {
      setBeforeTransform(mutate);
      setAfterTransform(mutate);
      return;
    }
    if (activeSide === 'before') setBeforeTransform(mutate);
    else setAfterTransform(mutate);
  };

  const zoom = (delta: number) => changeTransform(current => ({ ...current, zoom: Math.min(3, Math.max(1, Number((current.zoom + delta).toFixed(2)))) }));
  const pan = (dx: number, dy: number) => changeTransform(current => ({ ...current, x: current.x + dx, y: current.y + dy }));
  const reset = () => {
    setBeforeTransform(INITIAL_TRANSFORM);
    setAfterTransform(INITIAL_TRANSFORM);
  };
  const transformStyle = (value: TransformState) => ({ transform: `translate(${value.x}px, ${value.y}px) scale(${value.zoom})` });

  const exportBlob = async () => {
    if (!beforeUrl || !afterUrl) throw new Error('Selecione duas fotos correspondentes para exportar.');
    return exportSideBySideComparison(beforeUrl, afterUrl, displayDate(beforeSession.captured_at), displayDate(afterSession.captured_at));
  };

  const download = async () => {
    setExporting(true);
    try {
      const blob = await exportBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `comparacao-clinica-${Date.now()}.jpg`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } finally {
      setExporting(false);
    }
  };

  const share = async () => {
    setExporting(true);
    try {
      const blob = await exportBlob();
      const file = new File([blob], `comparacao-clinica-${Date.now()}.jpg`, { type: 'image/jpeg' });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: 'Comparação clínica' });
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } finally {
      setExporting(false);
    }
  };

  const fullscreen = async () => {
    if (dialogRef.current?.requestFullscreen) await dialogRef.current.requestFullscreen();
  };

  return (
    <div className="photo-comparison" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Comparação de fotos clínicas">
      <header className="photo-comparison__header">
        <div><strong>Comparar evolução</strong><span>{displayDate(beforeSession.captured_at)} → {displayDate(afterSession.captured_at)}</span></div>
        <div className="comparison-header-actions">
          <button className="secondary-action" onClick={() => void fullscreen()}><Expand size={17} /> Tela cheia</button>
          <button className="icon-button" onClick={onClose} aria-label="Fechar comparação"><X size={22} /></button>
        </div>
      </header>

      <div className="comparison-toolbar">
        <div className="segmented" aria-label="Modo de comparação">
          <button className={mode === 'side' ? 'is-active' : ''} onClick={() => setMode('side')}>Lado a lado</button>
          <button className={mode === 'slider' ? 'is-active' : ''} onClick={() => setMode('slider')}>Slider</button>
          <button className={mode === 'overlay' ? 'is-active' : ''} onClick={() => setMode('overlay')}>Overlay</button>
        </div>
        <label className="sync-toggle"><input type="checkbox" checked={sync} onChange={event => setSync(event.target.checked)} /> Sincronizar zoom/pan</label>
        {!sync && <div className="segmented compact"><button className={activeSide === 'before' ? 'is-active' : ''} onClick={() => setActiveSide('before')}>Antes</button><button className={activeSide === 'after' ? 'is-active' : ''} onClick={() => setActiveSide('after')}>Depois</button></div>}
        <div className="zoom-controls" aria-label="Controles de zoom e pan">
          <button onClick={() => zoom(-0.2)} aria-label="Diminuir zoom"><Minus size={16} /></button>
          <button onClick={() => zoom(0.2)} aria-label="Aumentar zoom"><Plus size={16} /></button>
          <button onClick={() => pan(-30, 0)} aria-label="Mover para esquerda"><ChevronLeft size={16} /></button>
          <button onClick={() => pan(30, 0)} aria-label="Mover para direita"><ChevronRight size={16} /></button>
          <button onClick={() => pan(0, -30)} aria-label="Mover para cima"><ChevronUp size={16} /></button>
          <button onClick={() => pan(0, 30)} aria-label="Mover para baixo"><ChevronDown size={16} /></button>
          <button onClick={reset}>Reset</button>
        </div>
      </div>

      <div className="comparison-angle-strip" role="tablist" aria-label="Ângulos disponíveis">
        {pairs.length === 0 ? <span>Não há fotos com ângulo estruturado para parear.</span> : pairs.map((item, index) => (
          <button key={`${item.angle}-${index}`} className={pairIndex === index ? 'is-active' : ''} onClick={() => { setPairIndex(index); reset(); }}>
            {PHOTO_ANGLE_LABELS[item.angle]}{!item.before || !item.after ? ' · sem par' : ''}
          </button>
        ))}
      </div>

      {!pair ? (
        <div className="comparison-empty">Selecione duas sessões com fotos organizadas por ângulo.</div>
      ) : !comparable ? (
        <div className="comparison-empty"><strong>{PHOTO_ANGLE_LABELS[pair.angle]}</strong><span>Sem foto correspondente nos dois lados. O Hub não inventa matching por IA.</span></div>
      ) : (
        <div className={`comparison-stage mode-${mode}`}>
          {mode === 'side' && (
            <>
              <figure><figcaption>ANTES · {displayDate(beforeSession.captured_at)}</figcaption><div className="comparison-image-frame"><img src={beforeUrl ?? ''} alt="Foto clínica anterior" style={transformStyle(beforeTransform)} /></div></figure>
              <figure><figcaption>DEPOIS · {displayDate(afterSession.captured_at)}</figcaption><div className="comparison-image-frame"><img src={afterUrl ?? ''} alt="Foto clínica posterior" style={transformStyle(afterTransform)} /></div></figure>
            </>
          )}
          {mode === 'slider' && (
            <div className="comparison-slider-stage">
              <img src={beforeUrl ?? ''} alt="Foto clínica anterior" style={transformStyle(beforeTransform)} />
              <div className="comparison-slider-after" style={{ clipPath: `inset(0 0 0 ${slider}%)` }}><img src={afterUrl ?? ''} alt="Foto clínica posterior" style={transformStyle(afterTransform)} /></div>
              <div className="comparison-slider-line" style={{ left: `${slider}%` }} aria-hidden="true" />
              <input className="comparison-slider-input" type="range" min="0" max="100" value={slider} onChange={event => setSlider(Number(event.target.value))} aria-label="Posição do divisor antes e depois" />
            </div>
          )}
          {mode === 'overlay' && (
            <div className="comparison-overlay-stage">
              <img src={beforeUrl ?? ''} alt="Foto clínica anterior" style={transformStyle(beforeTransform)} />
              <img src={afterUrl ?? ''} alt="Foto clínica posterior sobreposta" style={{ ...transformStyle(afterTransform), opacity: overlayOpacity / 100 }} />
              <label>Opacidade do depois <input type="range" min="0" max="100" value={overlayOpacity} onChange={event => setOverlayOpacity(Number(event.target.value))} /></label>
            </div>
          )}
        </div>
      )}

      <footer className="comparison-footer">
        <p>Comparação visual sem calibração geométrica, medidas automáticas, retoque ou alteração dos originais.</p>
        <div>
          <button className="secondary-action" disabled={!comparable || exporting} onClick={() => void download()}><Download size={17} /> Baixar comparação</button>
          <button className="primary-action" disabled={!comparable || exporting} onClick={() => void share()}><Share2 size={17} /> Compartilhar comparação</button>
        </div>
      </footer>
    </div>
  );
}
