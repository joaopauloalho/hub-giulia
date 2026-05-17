import { useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { InjectablePoint } from '../types';

const VB_W = 300;
const VB_H = 380;

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
    const qty = parseFloat(pendingQty) || 1;
    onAddPoint({
      x: pending.normX,
      y: pending.normY,
      service_id: activeServiceId,
      service_name: activeServiceName,
      color: activeColor,
      quantity: qty,
      unit: 'un',
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
        {/* ── Face anatomy ── */}
        <ellipse cx="150" cy="198" rx="112" ry="152" fill="#FDF6F0" stroke="#D4A574" strokeWidth="1.5"/>
        <ellipse cx="37" cy="202" rx="14" ry="22" fill="#FDF6F0" stroke="#D4A574" strokeWidth="1.5"/>
        <ellipse cx="263" cy="202" rx="14" ry="22" fill="#FDF6F0" stroke="#D4A574" strokeWidth="1.5"/>
        <path d="M 55 115 Q 100 55 150 48 Q 200 55 245 115" stroke="#B89068" strokeWidth="2"/>
        <path d="M 105 98 Q 150 91 195 98" stroke="#D4A574" strokeWidth="0.7" opacity="0.5"/>
        <path d="M 98 110 Q 150 103 202 110" stroke="#D4A574" strokeWidth="0.7" opacity="0.35"/>
        <path d="M 79 128 Q 106 116 130 123" stroke="#8B6347" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M 170 123 Q 194 116 221 128" stroke="#8B6347" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="M 80 149 Q 106 134 132 149 Q 106 164 80 149 Z" fill="white" stroke="#8B6347" strokeWidth="1.5"/>
        <circle cx="106" cy="149" r="9" fill="#4A7FA5"/>
        <circle cx="106" cy="149" r="5" fill="#1A1A1A"/>
        <circle cx="110" cy="145" r="2.5" fill="white"/>
        <path d="M 83 143 Q 106 136 129 143" stroke="#C4956A" strokeWidth="0.8"/>
        <path d="M 83 154 Q 106 159 129 154" stroke="#D4A574" strokeWidth="0.6"/>
        <path d="M 168 149 Q 194 134 220 149 Q 194 164 168 149 Z" fill="white" stroke="#8B6347" strokeWidth="1.5"/>
        <circle cx="194" cy="149" r="9" fill="#4A7FA5"/>
        <circle cx="194" cy="149" r="5" fill="#1A1A1A"/>
        <circle cx="198" cy="145" r="2.5" fill="white"/>
        <path d="M 171 143 Q 194 136 217 143" stroke="#C4956A" strokeWidth="0.8"/>
        <path d="M 171 154 Q 194 159 217 154" stroke="#D4A574" strokeWidth="0.6"/>
        <path d="M 136 163 L 133 204" stroke="#C4956A" strokeWidth="1.2"/>
        <path d="M 164 163 L 167 204" stroke="#C4956A" strokeWidth="1.2"/>
        <path d="M 133 204 Q 135 216 145 219 Q 150 221 155 219 Q 165 216 167 204" stroke="#C4956A" strokeWidth="1.5"/>
        <path d="M 122 211 Q 124 221 133 219" stroke="#C4956A" strokeWidth="1.5"/>
        <path d="M 167 219 Q 176 221 178 211" stroke="#C4956A" strokeWidth="1.5"/>
        <path d="M 122 211 Q 150 223 178 211" stroke="#C4956A" strokeWidth="0.8"/>
        <path d="M 122 211 Q 112 240 115 266" stroke="#D4A574" strokeWidth="1" strokeDasharray="3 3"/>
        <path d="M 178 211 Q 188 240 185 266" stroke="#D4A574" strokeWidth="1" strokeDasharray="3 3"/>
        <path d="M 144 223 L 140 243" stroke="#C4956A" strokeWidth="1"/>
        <path d="M 156 223 L 160 243" stroke="#C4956A" strokeWidth="1"/>
        <path d="M 116 249 Q 131 241 143 244 Q 150 241 157 244 Q 169 241 184 249 Q 168 257 150 255 Q 132 257 116 249 Z" fill="#E8A090" stroke="#C47B6A" strokeWidth="1"/>
        <path d="M 116 249 Q 132 260 150 263 Q 168 260 184 249 Q 167 278 150 281 Q 133 278 116 249 Z" fill="#E8A090" stroke="#C47B6A" strokeWidth="1"/>
        <path d="M 116 249 Q 150 255 184 249" stroke="#C47B6A" strokeWidth="1"/>
        <path d="M 115 266 Q 108 286 112 306" stroke="#D4A574" strokeWidth="0.8" strokeDasharray="3 3"/>
        <path d="M 185 266 Q 192 286 188 306" stroke="#D4A574" strokeWidth="0.8" strokeDasharray="3 3"/>
        <path d="M 131 309 Q 150 317 169 309" stroke="#D4A574" strokeWidth="1" strokeDasharray="3 3"/>
        <path d="M 122 349 L 118 374" stroke="#D4A574" strokeWidth="1.5"/>
        <path d="M 178 349 L 182 374" stroke="#D4A574" strokeWidth="1.5"/>
        <path d="M 118 374 Q 150 381 182 374" stroke="#D4A574" strokeWidth="1.2"/>

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
            min="0.1"
            step="0.5"
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
          <span style={{ fontSize: '0.74rem', color: 'var(--text-3)' }}>un</span>
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
      {editing && (
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
              min="0.1"
              step="0.5"
              value={editQty}
              onChange={e => setEditQty(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmEdit(); if (e.key === 'Escape') setEditing(null); }}
              style={{
                width: 64, padding: '4px 6px',
                border: '1px solid var(--border)', borderRadius: 6,
                fontSize: '0.88rem', background: 'var(--bg-2)', color: 'var(--text)',
              }}
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-3)' }}>un</span>
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
      )}
    </div>
  );
}
