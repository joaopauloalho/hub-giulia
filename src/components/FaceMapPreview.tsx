import type { InjectablePoint } from '../types';

const FACE_SVG = `<svg viewBox="0 0 300 380" xmlns="http://www.w3.org/2000/svg" fill="none">
<ellipse cx="150" cy="198" rx="112" ry="152" fill="#FDF6F0" stroke="#D4A574" stroke-width="1.5"/>
<ellipse cx="37" cy="202" rx="14" ry="22" fill="#FDF6F0" stroke="#D4A574" stroke-width="1.5"/>
<ellipse cx="263" cy="202" rx="14" ry="22" fill="#FDF6F0" stroke="#D4A574" stroke-width="1.5"/>
<path d="M 55 115 Q 100 55 150 48 Q 200 55 245 115" stroke="#B89068" stroke-width="2"/>
<path d="M 79 128 Q 106 116 130 123" stroke="#8B6347" stroke-width="2.5" stroke-linecap="round"/>
<path d="M 170 123 Q 194 116 221 128" stroke="#8B6347" stroke-width="2.5" stroke-linecap="round"/>
<path d="M 80 149 Q 106 134 132 149 Q 106 164 80 149 Z" fill="white" stroke="#8B6347" stroke-width="1.5"/>
<circle cx="106" cy="149" r="9" fill="#4A7FA5"/><circle cx="106" cy="149" r="5" fill="#1A1A1A"/><circle cx="110" cy="145" r="2.5" fill="white"/>
<path d="M 168 149 Q 194 134 220 149 Q 194 164 168 149 Z" fill="white" stroke="#8B6347" stroke-width="1.5"/>
<circle cx="194" cy="149" r="9" fill="#4A7FA5"/><circle cx="194" cy="149" r="5" fill="#1A1A1A"/><circle cx="198" cy="145" r="2.5" fill="white"/>
<path d="M 136 163 L 133 204" stroke="#C4956A" stroke-width="1.2"/><path d="M 164 163 L 167 204" stroke="#C4956A" stroke-width="1.2"/>
<path d="M 133 204 Q 135 216 145 219 Q 150 221 155 219 Q 165 216 167 204" stroke="#C4956A" stroke-width="1.5"/>
<path d="M 116 249 Q 131 241 143 244 Q 150 241 157 244 Q 169 241 184 249 Q 168 257 150 255 Q 132 257 116 249 Z" fill="#E8A090" stroke="#C47B6A" stroke-width="1"/>
<path d="M 116 249 Q 132 260 150 263 Q 168 260 184 249 Q 167 278 150 281 Q 133 278 116 249 Z" fill="#E8A090" stroke="#C47B6A" stroke-width="1"/>
</svg>`;

export function FaceMapPreview({ points, width = 260 }: { points: InjectablePoint[]; width?: number }) {
  return (
    <svg viewBox="0 0 300 380" width={width} role="img" aria-label="Mapa facial de injetaveis" style={{ maxWidth: '100%', height: 'auto' }}>
      <image href={`data:image/svg+xml;utf8,${encodeURIComponent(FACE_SVG)}`} x="0" y="0" width="300" height="380" />
      {points.map(point => {
        const x = point.x * 300;
        const y = point.y * 380;
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
