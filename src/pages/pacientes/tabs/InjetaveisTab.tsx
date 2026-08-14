import { useEffect, useRef, useState } from 'react';
import { Download, Syringe } from 'lucide-react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { useInjetaveis } from '../../../hooks/useInjetaveis';
import { useToast } from '../../../hooks/useToast';
import { FaceMapPreview } from '../../../components/FaceMapPreview';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { InjectableMap, InjectablePoint } from '../../../types';
import { sumDecimalQuantities, unitLabel } from '../../../lib/injectablesV2';

type RichInjectablePoint = InjectablePoint & {
  application_id?: string;
  product_id?: string;
  product_name?: string;
  product_category?: string;
  product_brand?: string;
  product_substance?: string;
  product_presentation?: string;
  lot_id?: string;
  lot_number?: string;
  expires_on?: string;
  region?: string;
  side?: string;
  note?: string;
};

type InjectableMapCompat = InjectableMap & {
  status?: 'draft' | 'finalized' | 'voided';
  source_type?: 'legacy' | 'v2';
  record_schema_version?: number;
  finalized_at?: string | null;
};

interface MapSummary {
  key: string;
  label: string;
  serviceName: string;
  total: string;
  unit: string | null;
  count: number;
  lotNumber: string | null;
  expiresOn: string | null;
  presentation: string | null;
}

function summarizeMapPoints(points: InjectablePoint[]): MapSummary[] {
  const groups = new Map<string, {
    label: string;
    serviceName: string;
    values: Array<string | number>;
    unit: string | null;
    count: number;
    lotNumber: string | null;
    expiresOn: string | null;
    presentation: string | null;
  }>();

  for (const rawPoint of points) {
    const point = rawPoint as RichInjectablePoint;
    const unit = point.unit?.trim() || null;
    const key = point.application_id
      ?? `${point.product_id ?? point.service_id}::${point.lot_id ?? point.lot_number ?? ''}::${unit ?? '<missing>'}`;
    const current = groups.get(key) ?? {
      label: point.product_name?.trim() || point.service_name || 'Aplicação injetável',
      serviceName: point.service_name || 'Aplicação injetável',
      values: [],
      unit,
      count: 0,
      lotNumber: point.lot_number?.trim() || null,
      expiresOn: point.expires_on || null,
      presentation: point.product_presentation?.trim() || null,
    };
    current.values.push(point.quantity);
    current.count += 1;
    groups.set(key, current);
  }

  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: group.label,
    serviceName: group.serviceName,
    total: sumDecimalQuantities(group.values),
    unit: group.unit,
    count: group.count,
    lotNumber: group.lotNumber,
    expiresOn: group.expiresOn,
    presentation: group.presentation,
  }));
}

// ─── SVG → PNG helper ─────────────────────────────────────────────────────────

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
<path d="M 122 211 Q 124 221 133 219" stroke="#C4956A" stroke-width="1.5"/><path d="M 167 219 Q 176 221 178 211" stroke="#C4956A" stroke-width="1.5"/>
<path d="M 122 211 Q 150 223 178 211" stroke="#C4956A" stroke-width="0.8"/>
<path d="M 116 249 Q 131 241 143 244 Q 150 241 157 244 Q 169 241 184 249 Q 168 257 150 255 Q 132 257 116 249 Z" fill="#E8A090" stroke="#C47B6A" stroke-width="1"/>
<path d="M 116 249 Q 132 260 150 263 Q 168 260 184 249 Q 167 278 150 281 Q 133 278 116 249 Z" fill="#E8A090" stroke="#C47B6A" stroke-width="1"/>
<path d="M 116 249 Q 150 255 184 249" stroke="#C47B6A" stroke-width="1"/>
<path d="M 122 349 L 118 374" stroke="#D4A574" stroke-width="1.5"/><path d="M 178 349 L 182 374" stroke="#D4A574" stroke-width="1.5"/>
<path d="M 118 374 Q 150 381 182 374" stroke="#D4A574" stroke-width="1.2"/>
</svg>`;

async function buildFaceDataUrl(points: InjectablePoint[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 760;
    const ctx = canvas.getContext('2d')!;
    const img = new window.Image();
    const blob = new Blob([FACE_SVG], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 600, 760);
      URL.revokeObjectURL(url);
      for (const point of points) {
        const x = point.x * 600;
        const y = point.y * 760;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = point.color;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(point.quantity), x, y);
      }
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

const pdfStyles = StyleSheet.create({
  page: { padding: 32, fontFamily: 'Helvetica', fontSize: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 10 },
  clinic: { fontSize: 14, fontWeight: 'bold', color: '#be185d' },
  meta: { fontSize: 9, color: '#666', marginTop: 2 },
  body: { flexDirection: 'row', gap: 16 },
  faceImg: { width: 210, height: 266 },
  table: { flex: 1 },
  tableTitle: { fontSize: 10, fontWeight: 'bold', color: '#444', marginBottom: 8 },
  row: { paddingVertical: 5, borderBottom: '1px solid #f0f0f0' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  rowLabel: { color: '#333', maxWidth: 130 },
  rowValue: { fontWeight: 'bold', color: '#be185d' },
  rowMeta: { fontSize: 8, color: '#777', marginTop: 2 },
  sigLine: { marginTop: 24, borderTop: '1px solid #000', paddingTop: 6, width: 200 },
  sigLabel: { fontSize: 8, color: '#888' },
});

function InjetaveisPDF({ map, patientName, faceDataUrl }: {
  map: InjectableMap;
  patientName: string;
  faceDataUrl: string;
}) {
  const report = summarizeMapPoints(map.points);
  const dateStr = format(new Date((map as InjectableMapCompat).finalized_at ?? map.created_at), 'dd/MM/yyyy', { locale: ptBR });

  return (
    <Document>
      <Page size="A4" style={pdfStyles.page}>
        <View style={pdfStyles.header}>
          <View>
            <Text style={pdfStyles.clinic}>Mapa de Injetáveis</Text>
            <Text style={pdfStyles.meta}>Paciente: {patientName}</Text>
            <Text style={pdfStyles.meta}>Data: {dateStr}</Text>
          </View>
        </View>
        <View style={pdfStyles.body}>
          <Image style={pdfStyles.faceImg} src={faceDataUrl} />
          <View style={pdfStyles.table}>
            <Text style={pdfStyles.tableTitle}>Registro da aplicação</Text>
            {report.map(item => (
              <View key={item.key} style={pdfStyles.row}>
                <View style={pdfStyles.rowTop}>
                  <Text style={pdfStyles.rowLabel}>{item.label}</Text>
                  <Text style={pdfStyles.rowValue}>{item.total} {unitLabel(item.unit)}</Text>
                </View>
                <Text style={pdfStyles.rowMeta}>{item.serviceName} · {item.count} ponto{item.count === 1 ? '' : 's'}</Text>
                {item.presentation && <Text style={pdfStyles.rowMeta}>Apresentação: {item.presentation}</Text>}
                {item.lotNumber && <Text style={pdfStyles.rowMeta}>Lote: {item.lotNumber}{item.expiresOn ? ` · Validade: ${item.expiresOn.split('-').reverse().join('/')}` : ''}</Text>}
              </View>
            ))}
            <View style={pdfStyles.sigLine}>
              <Text style={pdfStyles.sigLabel}>Assinatura</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

interface Props {
  patientId: string;
  patientName: string;
}

export function InjetaveisTab({ patientId, patientName }: Props) {
  const { maps, loading, error, load } = useInjetaveis(patientId);
  const { toast } = useToast();
  const downloadingRef = useRef<Set<string>>(new Set());
  const [openMapId, setOpenMapId] = useState<string | null>(null);

  useEffect(() => { load(); }, [load]);

  const fmtDate = (iso: string) => {
    try { return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); }
    catch { return iso; }
  };

  const handleDownload = async (map: InjectableMap) => {
    if (downloadingRef.current.has(map.id)) return;
    downloadingRef.current.add(map.id);
    try {
      const faceDataUrl = await buildFaceDataUrl(map.points);
      const blob = await pdf(
        <InjetaveisPDF map={map} patientName={patientName} faceDataUrl={faceDataUrl} />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `injetaveis-${patientName.replace(/\s+/g, '-')}-${map.id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      console.error('Erro ao gerar PDF:', cause);
      toast.error('Erro ao gerar PDF. Tente novamente.');
    } finally {
      downloadingRef.current.delete(map.id);
    }
  };

  if (loading) return <div className="loading-state">Carregando injetáveis...</div>;

  if (error) return (
    <div className="empty-state" style={{ padding: '32px 0' }}>
      <p>{error}</p>
    </div>
  );

  const historicalMaps = maps.filter(map => (map as InjectableMapCompat).status !== 'draft');

  if (historicalMaps.length === 0) return (
    <div className="empty-state" style={{ padding: '32px 0' }}>
      <Syringe size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
      <p>Nenhum mapa de injetáveis registrado ainda.</p>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-3)', maxWidth: 260, textAlign: 'center' }}>
        Os mapas finalizados aparecem aqui como histórico clínico somente leitura.
      </p>
    </div>
  );

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {historicalMaps.map(map => {
          const compat = map as InjectableMapCompat;
          const summary = summarizeMapPoints(map.points);
          const displayDate = compat.finalized_at ?? map.created_at;
          return (
            <div key={map.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              background: 'var(--bg-2)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 7 }}>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>{fmtDate(displayDate)}</span>
                    <span className="badge badge--gray">{compat.source_type === 'v2' ? 'Registro estruturado' : 'Legado'}</span>
                    <span className="badge badge--green">Somente leitura</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {summary.map(item => (
                      <div key={item.key} style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <span style={{ fontWeight: 700, fontSize: '0.86rem' }}>{item.label}</span>
                          <span style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '0.86rem', whiteSpace: 'nowrap' }}>
                            {item.total} {unitLabel(item.unit)}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 2 }}>
                          {item.serviceName} · {item.count} {item.count === 1 ? 'ponto' : 'pontos'}
                          {item.presentation ? ` · ${item.presentation}` : ''}
                        </div>
                        {item.lotNumber && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-2)', marginTop: 3 }}>
                            Lote {item.lotNumber}{item.expiresOn ? ` · validade ${item.expiresOn.split('-').reverse().join('/')}` : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {map.points.length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 7 }}>
                      {map.points.length} {map.points.length === 1 ? 'ponto registrado' : 'pontos registrados'}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => void handleDownload(map)}
                  style={{ color: 'var(--primary)', border: 'none', background: 'none', cursor: 'pointer', padding: 8, flexShrink: 0, minWidth: 44, minHeight: 44 }}
                  title="Baixar PDF"
                  aria-label="Baixar PDF do mapa"
                >
                  <Download size={18} />
                </button>
              </div>
              {map.points.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setOpenMapId(current => current === map.id ? null : map.id)}
                    aria-expanded={openMapId === map.id}
                    style={{ width: '100%' }}
                  >
                    {openMapId === map.id ? 'Ocultar mapa' : 'Ver mapa facial'}
                  </button>
                  {openMapId === map.id && (
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10 }}>
                      <FaceMapPreview points={map.points} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
