import { useState, useMemo } from 'react';
import { ChevronLeft, Check, Trash2, Eye, EyeOff } from 'lucide-react';
import { InjetaveisFaceMap } from '../../components/InjetaveisFaceMap';
import type { Service, InjectablePoint } from '../../types';

const COLORS = [
  '#9b59b6', '#3498db', '#e74c3c', '#2ecc71',
  '#f39c12', '#1abc9c', '#e91e63', '#ff5722',
];

interface Props {
  injectableServices: Service[];
  onDone: (points: InjectablePoint[]) => void;
  onCancel: () => void;
}

export function InjetaveisScreen({ injectableServices, onDone, onCancel }: Props) {
  const [points, setPoints] = useState<InjectablePoint[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showQty, setShowQty] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const activeService = injectableServices[activeIdx] ?? injectableServices[0];
  const activeColor = COLORS[activeIdx % COLORS.length];

  const addPoint = (p: Omit<InjectablePoint, 'id'>) => {
    setPoints(prev => [...prev, { ...p, id: Math.random().toString(36).slice(2) }]);
  };

  const updatePoint = (id: string, quantity: number) => {
    setPoints(prev => prev.map(p => p.id === id ? { ...p, quantity } : p));
  };

  const deletePoint = (id: string) => {
    setPoints(prev => prev.filter(p => p.id !== id));
  };

  const clearAll = () => {
    setPoints([]);
    setConfirmClear(false);
  };

  const report = useMemo(() => {
    const byService: Record<string, { name: string; color: string; count: number; total: number; unit: string }> = {};
    for (const p of points) {
      if (!byService[p.service_id]) {
        byService[p.service_id] = { name: p.service_name, color: p.color, count: 0, total: 0, unit: p.unit };
      }
      byService[p.service_id].count += 1;
      byService[p.service_id].total += p.quantity;
    }
    return Object.values(byService);
  }, [points]);

  return (
    <div className="drawer-overlay" onClick={onCancel}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Mapa de Injetáveis"
        onClick={e => e.stopPropagation()}
        style={{ display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}
      >
        {/* Header */}
        <div className="drawer-header">
          <button className="drawer-back" onClick={onCancel} aria-label="Cancelar">
            <ChevronLeft size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div className="drawer-title">Mapa de Injetáveis</div>
            <div className="drawer-sub">Clique no rosto para marcar os pontos</div>
          </div>
          <button
            onClick={() => setShowQty(v => !v)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 6, color: 'var(--text-3)' }}
            title={showQty ? 'Ocultar quantidades' : 'Exibir quantidades'}
          >
            {showQty ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>

        {/* Substance selector */}
        <div style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          background: 'var(--bg-2)',
        }}>
          {injectableServices.map((svc, i) => {
            const color = COLORS[i % COLORS.length];
            const active = i === activeIdx;
            return (
              <button
                key={svc.id}
                onClick={() => setActiveIdx(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 20,
                  border: `2px solid ${active ? color : 'var(--border)'}`,
                  background: active ? color + '18' : 'var(--bg)',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  fontWeight: active ? 700 : 400,
                  color: active ? color : 'var(--text-2)',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: color, flexShrink: 0, display: 'inline-block',
                }} />
                {svc.name}
              </button>
            );
          })}
        </div>

        {/* Face map */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 8px 8px' }}>
          <InjetaveisFaceMap
            points={points}
            activeServiceId={activeService?.id ?? null}
            activeColor={activeColor}
            activeServiceName={activeService?.name ?? ''}
            showQuantities={showQty}
            onAddPoint={addPoint}
            onUpdatePoint={updatePoint}
            onDeletePoint={deletePoint}
          />
        </div>

        {/* Unit report */}
        {report.length > 0 && (
          <div style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-2)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            {report.map(r => (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}>
                <span style={{ color: r.color, fontSize: '1rem', lineHeight: 1 }}>●</span>
                <span style={{ color: 'var(--text)', fontWeight: 500 }}>{r.name}</span>
                <span style={{ color: 'var(--text-3)' }}>—</span>
                <span style={{ color: 'var(--text-3)' }}>
                  {r.count} {r.count === 1 ? 'ponto' : 'pontos'}
                </span>
                <span style={{ color: 'var(--text-3)' }}>—</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{parseFloat(r.total.toFixed(1))} {r.unit}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          {confirmClear ? (
            <>
              <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--text-2)', alignSelf: 'center' }}>
                Apagar todos os pontos?
              </span>
              <button
                className="btn btn--ghost btn--sm"
                style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={clearAll}
              >
                Confirmar
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmClear(false)}>
                Não
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => points.length > 0 ? setConfirmClear(true) : onCancel()}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                {points.length > 0 ? <><Trash2 size={14} /> Limpar</> : 'Cancelar'}
              </button>
              <button
                className="btn btn--ghost btn--md"
                style={{ flex: 1 }}
                onClick={onCancel}
              >
                Pular
              </button>
              <button
                className="btn btn--primary btn--md"
                style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                onClick={() => onDone(points)}
              >
                <Check size={15} /> Salvar mapa
              </button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
