import { useEffect, useMemo, useRef } from 'react';
import { Download, Syringe } from 'lucide-react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { useInjetaveis } from '../../../hooks/useInjetaveis';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { InjectableMap, InjectablePoint } from '../../../types';

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
      for (const p of points) {
        const x = p.x * 600;
        const y = p.y * 760;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(p.quantity), x, y);
      }
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── PDF definition ────────────────────────────────────────────────────────────

const pdfStyles = StyleSheet.create({
  page: { padding: 32, fontFamily: 'Helvetica', fontSize: 10 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 10 },
  clinic: { fontSize: 14, fontWeight: 'bold', color: '#be185d' },
  meta: { fontSize: 9, color: '#666', marginTop: 2 },
  body: { flexDirection: 'row', gap: 16 },
  faceImg: { width: 210, height: 266 },
  table: { flex: 1 },
  tableTitle: { fontSize: 10, fontWeight: 'bold', color: '#444', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottom: '1px solid #f0f0f0' },
  rowLabel: { color: '#333' },
  rowValue: { fontWeight: 'bold', color: '#be185d' },
  sigLine: { marginTop: 24, borderTop: '1px solid #000', paddingTop: 6, width: 200 },
  sigLabel: { fontSize: 8, color: '#888' },
});

function InjetaveisPDF({ map, patientName, faceDataUrl }: {
  map: InjectableMap;
  patientName: string;
  faceDataUrl: string;
}) {
  const report = (() => {
    const by: Record<string, { name: string; count: number; total: number }> = {};
    for (const p of map.points) {
      if (!by[p.service_id]) by[p.service_id] = { name: p.service_name, count: 0, total: 0 };
      by[p.service_id].count += 1;
      by[p.service_id].total += p.quantity;
    }
    return Object.values(by);
  })();

  const dateStr = format(new Date(map.created_at), "dd/MM/yyyy", { locale: ptBR });

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
            <Text style={pdfStyles.tableTitle}>Substâncias utilizadas</Text>
            {report.map(r => (
              <View key={r.name} style={pdfStyles.row}>
                <Text style={pdfStyles.rowLabel}>{r.name}</Text>
                <Text style={pdfStyles.rowValue}>{r.total} un</Text>
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

// ─── Tab ──────────────────────────────────────────────────────────────────────

interface Props {
  patientId: string;
  patientName: string;
}

export function InjetaveisTab({ patientId, patientName }: Props) {
  const { maps, loading, error, load } = useInjetaveis(patientId);
  const downloadingRef = useRef<Set<string>>(new Set());

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
    } catch (e) {
      console.error('Erro ao gerar PDF:', e);
      alert('Erro ao gerar PDF. Tente novamente.');
    } finally {
      downloadingRef.current.delete(map.id);
    }
  };

  const summarize = (points: InjectablePoint[]) => {
    const by: Record<string, { name: string; total: number }> = {};
    for (const p of points) {
      if (!by[p.service_id]) by[p.service_id] = { name: p.service_name, total: 0 };
      by[p.service_id].total += p.quantity;
    }
    return Object.values(by);
  };

  if (loading) return <div className="loading-state">Carregando injetáveis...</div>;

  if (error) return (
    <div className="empty-state" style={{ padding: '32px 0' }}>
      <p>{error}</p>
    </div>
  );

  if (maps.length === 0) return (
    <div className="empty-state" style={{ padding: '32px 0' }}>
      <Syringe size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} />
      <p>Nenhum mapa de injetáveis registrado ainda.</p>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-3)', maxWidth: 260, textAlign: 'center' }}>
        Os mapas são criados ao registrar um atendimento com serviços injetáveis.
      </p>
    </div>
  );

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {maps.map(m => {
          const summary = summarize(m.points);
          return (
            <div key={m.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              background: 'var(--bg-2)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-3)', marginBottom: 6 }}>
                    {fmtDate(m.created_at)}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {summary.map(s => (
                      <div key={s.name} style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
                        <span style={{ fontWeight: 600 }}>{s.name}</span>
                        <span style={{ color: 'var(--text-3)' }}> — {s.total} un</span>
                      </div>
                    ))}
                  </div>
                  {m.points.length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 4 }}>
                      {m.points.length} {m.points.length === 1 ? 'ponto' : 'pontos'} marcados
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDownload(m)}
                  style={{ color: 'var(--primary)', border: 'none', background: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                  title="Baixar PDF"
                >
                  <Download size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
