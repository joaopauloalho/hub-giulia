import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Clock3, FileCheck2, PencilLine } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import type { AnamnesisCurrentRow, AnamnesisVersion } from '../../../lib/anamnesisV2';

interface Props { patientId: string; }

type SchemaField = {
  key?: string;
  label?: string;
  type?: string;
  detail_key?: string;
};

type SchemaSection = {
  key?: string;
  title?: string;
  fields?: SchemaField[];
};

const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function sectionAnswers(snapshot: Record<string, unknown>, sectionKey: string) {
  if (sectionKey === 'conditions') return (snapshot.conditions ?? {}) as Record<string, unknown>;
  if (sectionKey === 'medical_history' || sectionKey === 'womens_health') return (snapshot.surgical_history ?? {}) as Record<string, unknown>;
  if (sectionKey === 'habits') return (snapshot.habits ?? {}) as Record<string, unknown>;
  if (sectionKey === 'aesthetics') return (snapshot.aesthetics ?? {}) as Record<string, unknown>;
  return snapshot;
}

function displayValue(
  snapshot: Record<string, unknown>,
  sectionKey: string,
  field: SchemaField,
) {
  const key = field.key ?? '';
  const source = sectionAnswers(snapshot, sectionKey);
  const value = source[key];

  if (field.type === 'status_text') {
    const statusKey = key === 'medications' ? 'medications_status' : 'allergies_status';
    const status = snapshot[statusKey];
    if (status === 'none') return key === 'medications' ? 'Não utiliza' : 'Não possui';
    if (status === 'reported') return String(snapshot[key] ?? '').trim() || 'Informado sem descrição';
    return 'Não respondido';
  }

  if (field.type === 'text_legacy') {
    return String(snapshot[key] ?? '').trim() || 'Não informado no modelo legado';
  }

  if (field.type === 'boolean' || field.type === 'boolean_detail') {
    if (value === true) {
      if (field.detail_key) {
        const detail = String(source[field.detail_key] ?? '').trim();
        return detail ? `Sim — ${detail}` : 'Sim';
      }
      return 'Sim';
    }
    if (value === false) return 'Não';
    return 'Não respondido';
  }

  if (value === null || value === undefined || value === '') return 'Não respondido';
  return String(value);
}

function HistoricalVersion({ version }: { version: AnamnesisVersion }) {
  const sections = ((version.form_schema_snapshot.sections ?? []) as SchemaSection[])
    .filter(section => Array.isArray(section.fields));

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <div className="page-sub">
        Documento somente leitura · schema {version.form_schema_version}
        {version.migration_source === 'legacy' ? ' · migrado do modelo anterior' : ''}
      </div>
      {sections.map((section, sectionIndex) => (
        <div className="card" key={`${section.key ?? sectionIndex}`} style={{ padding: 12 }}>
          <strong style={{ display: 'block', marginBottom: 8 }}>{section.title ?? 'Seção'}</strong>
          <div style={{ display: 'grid', gap: 6 }}>
            {(section.fields ?? []).map((field, fieldIndex) => (
              <div key={`${field.key ?? fieldIndex}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, .8fr) minmax(0, 1.2fr)', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                <span className="page-sub">{field.label ?? field.key}</span>
                <span style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {displayValue(version.answers_snapshot, section.key ?? '', field)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AnamneseTab({ patientId }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [current, setCurrent] = useState<AnamnesisCurrentRow | null>(null);
  const [versions, setVersions] = useState<AnamnesisVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [currentResult, versionsResult] = await Promise.all([
        supabase.from('anamnesis').select('*').eq('patient_id', patientId).maybeSingle(),
        supabase
          .from('anamnesis_versions')
          .select('id,anamnesis_id,user_id,patient_id,version_number,form_schema_version,answers_snapshot,form_schema_snapshot,completed_at,author_user_id,source_type,migration_source,supersedes_version_id,created_at')
          .eq('patient_id', patientId)
          .order('version_number', { ascending: false }),
      ]);
      if (currentResult.error) throw currentResult.error;
      if (versionsResult.error) throw versionsResult.error;

      const nextCurrent = (currentResult.data ?? null) as AnamnesisCurrentRow | null;
      const nextVersions = (versionsResult.data ?? []) as AnamnesisVersion[];
      setCurrent(nextCurrent);
      setVersions(nextVersions);

      const requested = Number(searchParams.get('version') ?? 0);
      const requestedVersion = nextVersions.find(version => version.version_number === requested);
      setSelectedVersionId(requestedVersion?.id ?? null);
    } catch {
      setError('Não foi possível carregar a anamnese.');
    } finally {
      setLoading(false);
    }
  }, [patientId, searchParams]);

  useEffect(() => { void load(); }, [load]);

  const latest = versions[0] ?? null;
  if (loading) return <div className="loading-state">Carregando...</div>;
  if (error) return <div className="empty-state"><p>{error}</p></div>;

  return (
    <div style={{ padding: 18, display: 'grid', gap: 12 }}>
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <FileCheck2 size={17} />
              <strong>Anamnese atual</strong>
            </div>
            {latest ? (
              <div className="page-sub" style={{ marginTop: 6 }}>
                Versão {latest.version_number} · concluída em {dateTime(latest.completed_at)}
              </div>
            ) : (
              <div className="page-sub" style={{ marginTop: 6 }}>Nenhuma versão concluída.</div>
            )}
            {current?.status === 'draft' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13 }}>
                <Clock3 size={14} />
                <strong>Anamnese em atualização</strong>
                <span className="page-sub">· rascunho salvo {dateTime(current.last_saved_at)}</span>
              </div>
            )}
          </div>
          <button
            className="btn btn--primary btn--sm"
            type="button"
            onClick={() => navigate(`/pacientes/${patientId}/anamnese`)}
          >
            <PencilLine size={15} />
            {latest ? 'Atualizar anamnese' : current?.status === 'draft' ? 'Continuar anamnese' : 'Preencher anamnese'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <strong>Histórico</strong>
        {versions.length === 0 ? (
          <p className="page-sub" style={{ marginTop: 8 }}>Nenhuma versão concluída ainda.</p>
        ) : (
          <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
            {versions.map(version => {
              const open = selectedVersionId === version.id;
              return (
                <div key={version.id} style={{ border: '1px solid var(--border)', borderRadius: 9, overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedVersionId(open ? null : version.id)}
                    style={{ width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', border: 0, background: 'var(--bg-2)', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div style={{ flex: 1 }}>
                      <strong>Versão {version.version_number}</strong>
                      <div className="page-sub">{dateTime(version.completed_at)}{version.migration_source === 'legacy' ? ' · legado preservado' : ''}</div>
                    </div>
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {open && <div style={{ padding: '0 10px 10px' }}><HistoricalVersion version={version} /></div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
