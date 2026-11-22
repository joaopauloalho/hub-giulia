import { useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Pencil, Syringe } from 'lucide-react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { useInjetaveis } from '../../../hooks/useInjetaveis';
import { useToast } from '../../../hooks/useToast';
import { FaceMapPreview } from '../../../components/FaceMapPreview';
import {
  FACE_MAP_HEIGHT,
  FACE_MAP_IMAGE,
  FACE_MAP_WIDTH,
} from '../../../components/InjectableFaceMapBackground';
import { FinalizedInjectableEditor } from '../FinalizedInjectableEditor';
import { supabase } from '../../../lib/supabase';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { InjectableMap, InjectablePoint } from '../../../types';
import { sumDecimalQuantities, unitLabel } from '../../../lib/injectablesV2';

type RichInjectablePoint = InjectablePoint & {
  application_id?: string;
  product_id?: string;
  product_name?: string;
  product_presentation?: string;
  lot_id?: string;
  lot_number?: string;
  expires_on?: string;
};

type InjectableMapCompat = InjectableMap & {
  status?: 'draft' | 'finalized' | 'voided';
  source_type?: 'legacy' | 'v2';
  finalized_at?: string | null;
  procedure_summary?: string | null;
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
    const key = point.application_id ?? `${point.product_id ?? point.service_id}::${point.lot_id ?? point.lot_number ?? ''}::${unit ?? '<missing>'}`;
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

async function buildFaceDataUrl(points: InjectablePoint[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const canvasScale = 2;
    canvas.width = FACE_MAP_WIDTH * canvasScale;
    canvas.height = FACE_MAP_HEIGHT * canvasScale;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Não foi possível preparar o mapa para o PDF.'));
      return;
    }

    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
      const imageWidth = img.naturalWidth * scale;
      const imageHeight = img.naturalHeight * scale;
      ctx.drawImage(
        img,
        (canvas.width - imageWidth) / 2,
        (canvas.height - imageHeight) / 2,
        imageWidth,
        imageHeight,
      );

      for (const point of points) {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fillStyle = point.color; ctx.fill();
        ctx.strokeStyle = 'white'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = 'white'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(point.quantity), x, y);
      }
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Não foi possível carregar a imagem do mapa.'));
    img.src = FACE_MAP_IMAGE;
  });
}

const pdfStyles = StyleSheet.create({
  page: { padding: 32, fontFamily: 'Helvetica', fontSize: 10 },
  header: { marginBottom: 16, borderBottom: '1px solid #eee', paddingBottom: 10 },
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
  summary: { marginTop: 16, padding: 10, backgroundColor: '#fafafa' },
  summaryTitle: { fontSize: 9, fontWeight: 'bold', marginBottom: 4 },
  summaryText: { fontSize: 9, color: '#444', lineHeight: 1.4 },
});

function InjetaveisPDF({ map, patientName, faceDataUrl }: { map: InjectableMap; patientName: string; faceDataUrl: string }) {
  const report = summarizeMapPoints(map.points);
  const compat = map as InjectableMapCompat;
  const dateStr = format(new Date(compat.finalized_at ?? map.created_at), 'dd/MM/yyyy', { locale: ptBR });
  return <Document><Page size="A4" style={pdfStyles.page}>
    <View style={pdfStyles.header}><Text style={pdfStyles.clinic}>Registro interno de Injetáveis</Text><Text style={pdfStyles.meta}>Paciente: {patientName}</Text><Text style={pdfStyles.meta}>Data: {dateStr}</Text></View>
    <View style={pdfStyles.body}><Image style={pdfStyles.faceImg} src={faceDataUrl} /><View style={pdfStyles.table}><Text style={pdfStyles.tableTitle}>Aplicações</Text>{report.map(item => <View key={item.key} style={pdfStyles.row}><View style={pdfStyles.rowTop}><Text style={pdfStyles.rowLabel}>{item.label}</Text><Text style={pdfStyles.rowValue}>{item.total} {unitLabel(item.unit)}</Text></View><Text style={pdfStyles.rowMeta}>{item.serviceName} · {item.count} ponto{item.count === 1 ? '' : 's'}</Text>{item.lotNumber && <Text style={pdfStyles.rowMeta}>Lote: {item.lotNumber}{item.expiresOn ? ` · Validade: ${item.expiresOn.split('-').reverse().join('/')}` : ''}</Text>}</View>)}</View></View>
    {compat.procedure_summary && <View style={pdfStyles.summary}><Text style={pdfStyles.summaryTitle}>Resumo do procedimento</Text><Text style={pdfStyles.summaryText}>{compat.procedure_summary}</Text></View>}
  </Page></Document>;
}

interface Props { patientId: string; patientName: string; }

export function InjetaveisTab({ patientId, patientName }: Props) {
  const { maps, loading, error, load } = useInjetaveis(patientId);
  const { toast } = useToast();
  const downloadingRef = useRef<Set<string>>(new Set());
  const [openMapId, setOpenMapId] = useState<string | null>(null);
  const [editMapId, setEditMapId] = useState<string | null>(null);
  const [labelMaps, setLabelMaps] = useState<Set<string>>(new Set());

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const ids = maps.filter(map => (map as InjectableMapCompat).source_type === 'v2').map(map => map.id);
    if (ids.length === 0) { setLabelMaps(new Set()); return; }
    let alive = true;
    void supabase.from('injectable_applications').select('map_id,label_photo_path').in('map_id', ids).then(({ data }) => {
      if (!alive) return;
      setLabelMaps(new Set((data ?? []).filter(row => row.label_photo_path).map(row => row.map_id as string)));
    });
    return () => { alive = false; };
  }, [maps]);

  const fmtDate = (iso: string) => {
    try { return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }); }
    catch { return iso; }
  };

  const handleDownload = async (map: InjectableMap) => {
    if (downloadingRef.current.has(map.id)) return;
    downloadingRef.current.add(map.id);
    try {
      const faceDataUrl = await buildFaceDataUrl(map.points);
      const blob = await pdf(<InjetaveisPDF map={map} patientName={patientName} faceDataUrl={faceDataUrl} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `injetaveis-${patientName.replace(/\s+/g, '-')}-${map.id.slice(0, 8)}.pdf`; a.click(); URL.revokeObjectURL(url);
    } catch (cause) { console.error(cause); toast.error('Erro ao gerar PDF. Tente novamente.'); }
    finally { downloadingRef.current.delete(map.id); }
  };

  if (loading) return <div className="loading-state">Carregando injetáveis...</div>;
  if (error) return <div className="empty-state" style={{ padding: '32px 0' }}><p>{error}</p></div>;

  const historicalMaps = maps.filter(map => (map as InjectableMapCompat).status !== 'draft');
  if (historicalMaps.length === 0) return <div className="empty-state" style={{ padding: '32px 0' }}><Syringe size={48} strokeWidth={1} style={{ color: 'var(--primary-lt)' }} /><p>Nenhum mapa de injetáveis registrado ainda.</p><p style={{ fontSize: '0.82rem', color: 'var(--text-3)', maxWidth: 300, textAlign: 'center' }}>Quando houver um registro, você poderá voltar e completar ou editar o mesmo mapa.</p></div>;

  return <>
    <div style={{ padding: 20 }}><div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {historicalMaps.map(map => {
        const compat = map as InjectableMapCompat;
        const summary = summarizeMapPoints(map.points);
        const displayDate = compat.finalized_at ?? map.created_at;
        const canEdit = compat.source_type === 'v2' && compat.status === 'finalized';
        return <div key={map.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', background: 'var(--bg-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 7 }}><span style={{ fontSize: '0.82rem', color: 'var(--text-3)' }}>{fmtDate(displayDate)}</span><span className="badge badge--gray">{compat.source_type === 'v2' ? 'Registro estruturado' : 'Legado'}</span>{canEdit && <span className="badge badge--green">Editável</span>}{labelMaps.has(map.id) && <span className="badge badge--gray"><ImageIcon size={11} /> Etiqueta anexada</span>}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{summary.map(item => <div key={item.key} style={{ padding: '8px 10px', borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ fontWeight: 700, fontSize: '0.86rem' }}>{item.label}</span><span style={{ fontWeight: 800, color: 'var(--primary)', fontSize: '0.86rem', whiteSpace: 'nowrap' }}>{item.total} {unitLabel(item.unit)}</span></div><div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginTop: 2 }}>{item.serviceName} · {item.count} {item.count === 1 ? 'ponto' : 'pontos'}{item.presentation ? ` · ${item.presentation}` : ''}</div>{item.lotNumber && <div style={{ fontSize: '0.72rem', color: 'var(--text-2)', marginTop: 3 }}>Lote {item.lotNumber}{item.expiresOn ? ` · validade ${item.expiresOn.split('-').reverse().join('/')}` : ''}</div>}</div>)}</div>
              {compat.procedure_summary && <div style={{ marginTop: 9, padding: '9px 10px', borderRadius: 9, background: 'var(--bg)', border: '1px solid var(--border)' }}><div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-2)', marginBottom: 3 }}>Resumo do procedimento</div><div style={{ fontSize: '0.78rem', color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{compat.procedure_summary}</div></div>}
              {map.points.length > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 7 }}>{map.points.length} {map.points.length === 1 ? 'ponto registrado' : 'pontos registrados'}</div>}
            </div>
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>{canEdit && <button onClick={() => setEditMapId(map.id)} style={{ color: 'var(--primary)', border: 'none', background: 'none', cursor: 'pointer', padding: 8, minWidth: 44, minHeight: 44 }} title="Editar este registro" aria-label="Editar este registro de injetáveis"><Pencil size={18} /></button>}<button onClick={() => void handleDownload(map)} style={{ color: 'var(--primary)', border: 'none', background: 'none', cursor: 'pointer', padding: 8, minWidth: 44, minHeight: 44 }} title="Baixar PDF" aria-label="Baixar PDF do mapa"><Download size={18} /></button></div>
          </div>
          {map.points.length > 0 && <div style={{ marginTop: 10 }}><button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpenMapId(current => current === map.id ? null : map.id)} aria-expanded={openMapId === map.id} style={{ width: '100%' }}>{openMapId === map.id ? 'Ocultar mapa' : 'Ver mapa facial'}</button>{openMapId === map.id && <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10 }}><FaceMapPreview points={map.points} /></div>}</div>}
        </div>;
      })}
    </div></div>
    {editMapId && <FinalizedInjectableEditor mapId={editMapId} patientId={patientId} onClose={() => setEditMapId(null)} onSaved={() => void load()} />}
  </>;
}
