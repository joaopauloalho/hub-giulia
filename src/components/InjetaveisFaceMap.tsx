import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { InjectablePoint } from '../types';

const VB_W = 300;
const VB_H = 380;

function getServiceConfig(name: string): { step: number; unit: string; min: number } {
  const n = name.toLowerCase();
  if (n.includes('botox') || n.includes('toxina') || n.includes('botulin')) {
    return { step: 1, unit: 'U', min: 1 };
  }
  if (n.includes('preenchi') || n.includes('filler') || n.includes('hialur')) {
    return { step: 0.1, unit: 'ml', min: 0.1 };
  }
  if (n.includes('bio') || n.includes('estimulad') || n.includes('bioestimul')) {
    return { step: 0.1, unit: 'ml', min: 0.1 };
  }
  return { step: 1, unit: 'U', min: 1 };
}

interface Props {
  points: InjectablePoint[];
  activeServiceId: string | null;
  activeColor: string;
  activeServiceName: string;
  showQuantities: boolean;
  onAddPoint: (p: Omit<InjectablePoint, 'id'>) => void;
  onUpdatePoint: (id: string, quantity: number) => void;
  onDeletePoint: (id: string) => void;
}

interface Pending {
  svgX: number;
  svgY: number;
  normX: number;
  normY: number;
  clientX: number;
  clientY: number;
}

interface Editing {
  point: InjectablePoint;
  clientX: number;
  clientY: number;
}

export function InjetaveisFaceMap({
  points,
  activeServiceId,
  activeColor,
  activeServiceName,
  showQuantities,
  onAddPoint,
  onUpdatePoint,
  onDeletePoint,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingQty, setPendingQty] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editQty, setEditQty] = useState('');

  const activeConfig = getServiceConfig(activeServiceName);

  const toRelative = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const scaleX = VB_W / rect.width;
    const scaleY = VB_H / rect.height;
    return {
      svgX: (clientX - rect.left) * scaleX,
      svgY: (clientY - rect.top) * scaleY,
      normX: ((clientX - rect.left) * scaleX) / VB_W,
      normY: ((clientY - rect.top) * scaleY) / VB_H,
    };
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!activeServiceId || pending || editing) return;
    const target = e.target as SVGElement;
    if (target.closest('[data-point]')) return;
    const coords = toRelative(e.clientX, e.clientY);
    setPending({ ...coords, clientX: e.clientX, clientY: e.clientY });
    setPendingQty('');
  };

  const handlePointClick = (e: React.MouseEvent, p: InjectablePoint) => {
    e.stopPropagation();
    if (pending) return;
    setEditing({ point: p, clientX: e.clientX, clientY: e.clientY });
    setEditQty(String(p.quantity));
  };

  const confirmAdd = () => {
    if (!pending || !activeServiceId) return;
    const qty = parseFloat(pendingQty) || activeConfig.min;
    onAddPoint({
      x: pending.normX,
      y: pending.normY,
      service_id: activeServiceId,
      service_name: activeServiceName,
      color: activeColor,
      quantity: qty,
      unit: activeConfig.unit,
    });
    setPending(null);
    setPendingQty('');
  };

  const confirmEdit = () => {
    if (!editing) return;
    onUpdatePoint(editing.point.id, parseFloat(editQty) || editing.point.quantity);
    setEditing(null);
  };

  const dismissAll = () => {
    setPending(null);
    setEditing(null);
  };

  const popupStyle = (clientX: number, clientY: number): React.CSSProperties => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return { position: 'absolute', top: 0, left: 0 };
    let left = clientX - wrap.left - 65;
    let top = clientY - wrap.top - 80;
    if (left < 4) left = 4;
    if (left + 170 > wrap.width) left = wrap.width - 174;
    if (top < 4) top = 4;
    return { position: 'absolute', left, top, zIndex: 20 };
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', userSelect: 'none' }}>
      {(pending || editing) && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 15 }}
          onClick={dismissAll}
        />
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        style={{
          width: '100%',
          maxWidth: 520,
          display: 'block',
          margin: '0 auto',
          cursor: activeServiceId && !pending && !editing ? 'crosshair' : 'default',
          touchAction: 'none',
        }}
        onClick={handleSvgClick}
      >
        {/* ── Face image ── */}
        <image href="/Face_FRONT.png" x="0" y="0" width="300" height="380" preserveAspectRatio="xMidYMid meet"/>

        {/* ── Injection points ── */}
        {points.map(p => (
          <g
            key={p.id}
            data-point="1"
            onClick={e => handlePointClick(e as React.MouseEvent, p)}
            style={{ cursor: 'pointer' }}
          >
            <circle
              cx={p.x * VB_W}
              cy={p.y * VB_H}
              r={9}
              fill={p.color}
              stroke="white"
              strokeWidth={2}
            />
            {showQuantities && (
              <text
                x={p.x * VB_W}
                y={p.y * VB_H + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={8}
                fontWeight="bold"
                fill="white"
                style={{ pointerEvents: 'none' }}
              >
                {p.quantity}
              </text>
            )}
          </g>
        ))}

        {/* Pending preview dot */}
        {pending && (
          <circle
            cx={pending.svgX}
            cy={pending.svgY}
            r={9}
            fill={activeColor}
            stroke="white"
            strokeWidth={2}
            opacity={0.6}
          />
        )}
      </svg>

      {/* ── New point quantity input ── */}
      {pending && (
        <div style={{
          ...popupStyle(pending.clientX, pending.clientY),
          background: 'var(--bg)',
          border: '1.5px solid var(--border)',
          borderRadius: 10,
          padding: '8px 10px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          minWidth: 150,
        }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: activeColor, flexShrink: 0, display: 'inline-block' }} />
          <input
            autoFocus
            type="number"
            min={activeConfig.min}
            step={activeConfig.step}
            value={pendingQty}
            onChange={e => setPendingQty(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') confirmAdd(); if (e.key === 'Escape') setPending(null); }}
            placeholder="Qtd"
            style={{
              width: 56, padding: '4px 6px',
              border: '1px solid var(--border)', borderRadius: 6,
              fontSize: '0.88rem', background: 'var(--bg-2)', color: 'var(--text)',
            }}
          />
          <span style={{ fontSize: '0.74rem', color: 'var(--text-3)' }}>{activeConfig.unit}</span>
          <button
            onClick={confirmAdd}
            style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--primary)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <Check size={13} color="white" strokeWidth={3} />
          </button>
          <button
            onClick={() => setPending(null)}
            style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--bg-2)', border: '1px solid var(--border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            <X size={12} color="var(--text-3)" />
          </button>
        </div>
      )}

      {/* ── Edit existing point ── */}
      {editing && (() => {
        const editConfig = getServiceConfig(editing.point.service_name);
        return (
          <div style={{
            ...popupStyle(editing.clientX, editing.clientY),
            background: 'var(--bg)',
            border: '1.5px solid var(--border)',
            borderRadius: 10,
            padding: '10px 12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            minWidth: 170,
          }}>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-3)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: editing.point.color, flexShrink: 0, display: 'inline-block' }} />
              {editing.point.service_name}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <input
                autoFocus
                type="number"
                min={editConfig.min}
                step={editConfig.step}
                value={editQty}
                onChange={e => setEditQty(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditing(null); }}
                style={{
                  width: 64, padding: '4px 6px',
                  border: '1px solid var(--border)', borderRadius: 6,
                  fontSize: '0.88rem', background: 'var(--bg-2)', color: 'var(--text)',
                }}
              />
              <span style={{ fontSize: '0.74rem', color: 'var(--text-3)' }}>{editing.point.unit || editConfig.unit}</span>
              <button
                onClick={confirmEdit}
                style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--primary)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
                <Check size={13} color="white" strokeWidth={3} />
              </button>
            </div>
            <button
              onClick={() => { onDeletePoint(editing.point.id); setEditing(null); }}
              style={{
                width: '100%', padding: '5px 0',
                background: '#fff5f5', border: '1px solid #fecaca',
                borderRadius: 6, cursor: 'pointer',
                fontSize: '0.78rem', color: 'var(--red)', fontWeight: 600,
              }}
            >
              Remover ponto
            </button>
          </div>
        );
      })()}
    </div>
  );
}
