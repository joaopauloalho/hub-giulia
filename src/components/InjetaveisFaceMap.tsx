import { useRef } from 'react';
import { clampNormalized, unitLabel } from '../lib/injectablesV2';

const VB_W = 300;
const VB_H = 380;

export interface FaceMapPoint {
  id: string;
  applicationId: string;
  x: number;
  y: number;
  quantity: string;
  unit: string;
  color: string;
  label: string;
  region?: string;
  side?: string;
}

interface Props {
  points: FaceMapPoint[];
  activeApplicationId: string | null;
  activeColor: string;
  selectedPointId: string | null;
  showQuantities: boolean;
  readOnly?: boolean;
  onAddCoordinate: (x: number, y: number) => void;
  onSelectPoint: (id: string) => void;
  onMovePoint: (id: string, x: number, y: number) => void;
}

interface DragState {
  pointId: string;
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

export function InjetaveisFaceMap({
  points,
  activeApplicationId,
  activeColor,
  selectedPointId,
  showQuantities,
  readOnly = false,
  onAddCoordinate,
  onSelectPoint,
  onMovePoint,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const toNormalized = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: clampNormalized((clientX - rect.left) / rect.width),
      y: clampNormalized((clientY - rect.top) / rect.height),
    };
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly || !activeApplicationId) return;
    const target = event.target as SVGElement;
    if (target.closest('[data-injectable-point]')) return;
    const coordinate = toNormalized(event.clientX, event.clientY);
    onAddCoordinate(coordinate.x, coordinate.y);
  };

  const handlePointPointerDown = (event: React.PointerEvent<SVGGElement>, point: FaceMapPoint) => {
    event.stopPropagation();
    onSelectPoint(point.id);
    if (readOnly) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointId: point.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const handlePointPointerMove = (event: React.PointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || readOnly) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance > 3) drag.moved = true;
    if (!drag.moved) return;

    const coordinate = toNormalized(event.clientX, event.clientY);
    onMovePoint(drag.pointId, coordinate.x, coordinate.y);
  };

  const handlePointPointerUp = (event: React.PointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
      dragRef.current = null;
    }
  };

  return (
    <div className="injectables-map-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="injectables-face-svg"
        onPointerDown={handleBackgroundPointerDown}
        role="img"
        aria-label="Mapa facial de pontos de aplicação"
      >
        <image
          href="/face-botox.png"
          x="0"
          y="0"
          width={VB_W}
          height={VB_H}
          preserveAspectRatio="xMidYMid meet"
          style={{ pointerEvents: 'none' }}
        />

        {points.map(point => {
          const selected = point.id === selectedPointId;
          const label = `${point.label}${point.region ? `, ${point.region}` : ''} — ${point.quantity || 'quantidade não informada'} ${unitLabel(point.unit)}`;
          return (
            <g
              key={point.id}
              data-injectable-point="true"
              role="button"
              tabIndex={0}
              aria-label={label}
              onPointerDown={event => handlePointPointerDown(event, point)}
              onPointerMove={handlePointPointerMove}
              onPointerUp={handlePointPointerUp}
              onPointerCancel={() => { dragRef.current = null; }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectPoint(point.id);
                }
              }}
              className="injectables-map-point"
            >
              <circle
                cx={point.x * VB_W}
                cy={point.y * VB_H}
                r={12}
                fill="transparent"
              />
              {selected && (
                <circle
                  cx={point.x * VB_W}
                  cy={point.y * VB_H}
                  r={8}
                  fill="none"
                  stroke={point.color}
                  strokeWidth={1.5}
                  opacity={0.55}
                />
              )}
              <circle
                cx={point.x * VB_W}
                cy={point.y * VB_H}
                r={selected ? 5.8 : 5}
                fill={point.color || activeColor}
                stroke="white"
                strokeWidth={1.5}
              />
              {showQuantities && point.quantity && (
                <text
                  x={point.x * VB_W}
                  y={point.y * VB_H + 0.5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={4.8}
                  fontWeight="700"
                  fill="white"
                  style={{ pointerEvents: 'none' }}
                >
                  {point.quantity}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
