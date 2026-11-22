import type { InjectablePoint } from '../types';
import {
  FACE_MAP_HEIGHT,
  FACE_MAP_WIDTH,
  InjectableFaceMapBackground,
} from './InjectableFaceMapBackground';

export function FaceMapPreview({ points, width = 260 }: { points: InjectablePoint[]; width?: number }) {
  return (
    <svg
      viewBox={`0 0 ${FACE_MAP_WIDTH} ${FACE_MAP_HEIGHT}`}
      width={width}
      role="img"
      aria-label="Mapa facial de injetáveis"
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      <InjectableFaceMapBackground />
      {points.map(point => {
        const x = point.x * FACE_MAP_WIDTH;
        const y = point.y * FACE_MAP_HEIGHT;
        return (
          <g key={point.id}>
            <circle cx={x} cy={y} r="10" fill={point.color} stroke="#fff" strokeWidth="3" />
            <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize="9" fontWeight="700">
              {point.quantity}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
