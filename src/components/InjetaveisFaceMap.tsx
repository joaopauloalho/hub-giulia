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
          maxWidth: 320,
          display: 'block',
          margin: '0 auto',
          cursor: activeServiceId && !pending && !editing ? 'crosshair' : 'default',
          touchAction: 'none',
        }}
        onClick={handleSvgClick}
      >
        {/* ── Hair cap (behind face) ── */}
        <ellipse cx="150" cy="72" rx="112" ry="70" fill="#E0DED8" stroke="#1A1A1A" strokeWidth="1.6"/>
        <path d="M 60 105 Q 78 62 118 44" stroke="#C8C6C0" strokeWidth="0.7" fill="none"/>
        <path d="M 55 120 Q 70 80 108 60" stroke="#C8C6C0" strokeWidth="0.6" fill="none"/>
        <path d="M 240 105 Q 222 62 182 44" stroke="#C8C6C0" strokeWidth="0.7" fill="none"/>
        <path d="M 245 120 Q 230 80 192 60" stroke="#C8C6C0" strokeWidth="0.6" fill="none"/>
        <path d="M 95 38 Q 150 26 205 38" stroke="#C8C6C0" strokeWidth="0.6" fill="none"/>

        {/* ── Face oval ── */}
        <ellipse cx="150" cy="203" rx="108" ry="140" fill="#F6EAD8" stroke="#1A1A1A" strokeWidth="1.7"/>

        {/* ── Ears ── */}
        <ellipse cx="41" cy="203" rx="13" ry="20" fill="#F6EAD8" stroke="#1A1A1A" strokeWidth="1.4"/>
        <path d="M 45 194 Q 41 203 45 212" stroke="#C4906A" strokeWidth="0.9" fill="none"/>
        <ellipse cx="259" cy="203" rx="13" ry="20" fill="#F6EAD8" stroke="#1A1A1A" strokeWidth="1.4"/>
        <path d="M 255 194 Q 259 203 255 212" stroke="#C4906A" strokeWidth="0.9" fill="none"/>

        {/* ── Eyebrows ── */}
        <path d="M 84 146 Q 104 136 126 141" stroke="#4E3520" strokeWidth="2.6" strokeLinecap="round" fill="none"/>
        <path d="M 174 141 Q 196 136 216 146" stroke="#4E3520" strokeWidth="2.6" strokeLinecap="round" fill="none"/>

        {/* ── Left Eye ── */}
        <path d="M 80 163 Q 104 149 128 163 Q 104 177 80 163 Z" fill="white" stroke="#1A1A1A" strokeWidth="1.4"/>
        <circle cx="104" cy="163" r="9.5" fill="#7AA8C6"/>
        <circle cx="104" cy="163" r="5.8" fill="#18182E"/>
        <circle cx="107.5" cy="159" r="2.4" fill="white" opacity="0.9"/>
        <path d="M 80 163 Q 104 148 128 163" stroke="#1A1A1A" strokeWidth="1.7" fill="none"/>
        <path d="M 84 159 L 82 154" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>
        <path d="M 93 153 L 92 148" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>
        <path d="M 104 150 L 104 145" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>
        <path d="M 115 153 L 117 148" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>
        <path d="M 124 159 L 126 154" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>

        {/* ── Right Eye ── */}
        <path d="M 172 163 Q 196 149 220 163 Q 196 177 172 163 Z" fill="white" stroke="#1A1A1A" strokeWidth="1.4"/>
        <circle cx="196" cy="163" r="9.5" fill="#7AA8C6"/>
        <circle cx="196" cy="163" r="5.8" fill="#18182E"/>
        <circle cx="199.5" cy="159" r="2.4" fill="white" opacity="0.9"/>
        <path d="M 172 163 Q 196 148 220 163" stroke="#1A1A1A" strokeWidth="1.7" fill="none"/>
        <path d="M 176 159 L 174 154" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>
        <path d="M 185 153 L 184 148" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>
        <path d="M 196 150 L 196 145" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>
        <path d="M 207 153 L 209 148" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>
        <path d="M 216 159 L 218 154" stroke="#1A1A1A" strokeWidth="1" strokeLinecap="round"/>

        {/* ── Nose ── */}
        <path d="M 140 178 L 135 214" stroke="#C4906A" strokeWidth="1.1" fill="none" opacity="0.75"/>
        <path d="M 160 178 L 165 214" stroke="#C4906A" strokeWidth="1.1" fill="none" opacity="0.75"/>
        <path d="M 135 214 Q 126 219 124 226 Q 128 231 138 228" stroke="#C4906A" strokeWidth="1.1" fill="none"/>
        <path d="M 165 214 Q 174 219 176 226 Q 172 231 162 228" stroke="#C4906A" strokeWidth="1.1" fill="none"/>
        <path d="M 138 228 Q 150 230 162 228" stroke="#C4906A" strokeWidth="1" fill="none"/>

        {/* ── Nasolabial folds ── */}
        <path d="M 124 226 Q 116 242 118 256" stroke="#D4A080" strokeWidth="0.7" fill="none" opacity="0.4"/>
        <path d="M 176 226 Q 184 242 182 256" stroke="#D4A080" strokeWidth="0.7" fill="none" opacity="0.4"/>

        {/* ── Lips ── */}
        <path d="M 118 256 Q 133 247 150 251 Q 167 247 182 256 Q 166 265 150 265 Q 134 265 118 256 Z"
              fill="#E8978A" stroke="#C47868" strokeWidth="1.1"/>
        <path d="M 118 256 Q 134 265 150 265 Q 166 265 182 256 Q 172 283 150 287 Q 128 283 118 256 Z"
              fill="#E8978A" stroke="#C47868" strokeWidth="1.1"/>
        <path d="M 118 256 Q 150 260 182 256" stroke="#C47868" strokeWidth="0.9"/>
        <path d="M 132 250 Q 141 245 150 251 Q 159 245 168 250" stroke="#C47868" strokeWidth="0.7" fill="none"/>

        {/* ── Neck ── */}
        <path d="M 122 335 L 118 372" stroke="#1A1A1A" strokeWidth="1.5"/>
        <path d="M 178 335 L 182 372" stroke="#1A1A1A" strokeWidth="1.5"/>
        <path d="M 118 372 Q 150 378 182 372" stroke="#1A1A1A" strokeWidth="1.3"/>
        <path d="M 142 342 L 140 370" stroke="#D4A080" strokeWidth="0.8" opacity="0.35"/>
        <path d="M 158 342 L 160 370" stroke="#D4A080" strokeWidth="0.8" opacity="0.35"/>

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
