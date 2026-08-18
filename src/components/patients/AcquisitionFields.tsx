import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  ACQUISITION_DETAIL_SOURCES,
  ACQUISITION_SOURCE_KEYS,
  ACQUISITION_SOURCE_LABEL,
  type AcquisitionDraft,
  type AcquisitionSource,
} from '../../lib/acquisition';

type PatientCandidate = { id: string; name: string; phone: string | null; archived_at: string | null };

type Props = {
  value: AcquisitionDraft;
  onChange: (value: AcquisitionDraft) => void;
  excludePatientId?: string | null;
  idPrefix?: string;
};

export function AcquisitionFields({ value, onChange, excludePatientId = null, idPrefix = 'acquisition' }: Props) {
  const [mode, setMode] = useState<'linked' | 'manual'>(() => value.referrerName && !value.referredByPatientId ? 'manual' : 'linked');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<PatientCandidate[]>([]);
  const [selected, setSelected] = useState<PatientCandidate | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!value.referredByPatientId) { setSelected(null); return; }
    let alive = true;
    void supabase.from('patients').select('id,name,phone,archived_at').eq('id', value.referredByPatientId).maybeSingle().then(({ data }) => {
      if (alive && data) setSelected(data as PatientCandidate);
    });
    return () => { alive = false; };
  }, [value.referredByPatientId]);

  useEffect(() => {
    if (value.source !== 'referral' || mode !== 'linked' || query.trim().length < 2) { setCandidates([]); return; }
    const timer = window.setTimeout(() => {
      let request = supabase.from('patients').select('id,name,phone,archived_at').ilike('name', `%${query.trim().replace(/[%_]/g, '')}%`).order('name').limit(8);
      if (excludePatientId) request = request.neq('id', excludePatientId);
      setLoading(true);
      void request.then(({ data, error }) => {
        if (!error) setCandidates((data ?? []) as PatientCandidate[]);
        setLoading(false);
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [excludePatientId, mode, query, value.source]);

  const detailLabel = useMemo(() => value.source === 'partnership' ? 'Qual parceria?' : value.source === 'campaign' ? 'Qual campanha?' : 'Qual?', [value.source]);
  const setSource = (source: AcquisitionSource | null) => onChange({ ...value, source });

  return <div data-testid={`${idPrefix}-fields`} style={{ display: 'grid', gap: 10 }}>
    <div className="field">
      <label className="field-label" htmlFor={`${idPrefix}-source`}>Como conheceu a clínica?</label>
      <select
        id={`${idPrefix}-source`}
        data-testid={`${idPrefix}-source`}
        className="field-input"
        value={value.source ?? ''}
        onChange={event => setSource((event.target.value || null) as AcquisitionSource | null)}
        style={{ minHeight: 44 }}
      >
        <option value="">Não informado</option>
        {ACQUISITION_SOURCE_KEYS.map(source => <option key={source} value={source}>{ACQUISITION_SOURCE_LABEL[source]}</option>)}
      </select>
      {!value.source && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Opcional — pode ser preenchido depois.</span>}
    </div>

    {value.source === 'referral' && <div style={{ display: 'grid', gap: 9 }}>
      <div className="field-label">Quem indicou?</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className={`btn btn--sm ${mode === 'linked' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setMode('linked')}>Buscar paciente</button>
        <button type="button" className={`btn btn--sm ${mode === 'manual' ? 'btn--primary' : 'btn--ghost'}`} onClick={() => setMode('manual')}>Pessoa não cadastrada</button>
      </div>
      {mode === 'linked' ? <div style={{ position: 'relative' }}>
        {selected && value.referredByPatientId ? <div className="card" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}><strong>{selected.name}</strong>{selected.archived_at && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-3)' }}>(arquivada)</span>}{selected.phone && <div className="page-sub">{selected.phone}</div>}</div>
          <button type="button" className="icon-btn" aria-label="Remover paciente indicadora" onClick={() => { onChange({ ...value, referredByPatientId: null }); setSelected(null); setQuery(''); }}><X size={16} /></button>
        </div> : <>
          <div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 14, color: 'var(--text-3)' }} /><input data-testid={`${idPrefix}-referrer-search`} className="field-input" style={{ paddingLeft: 34, minHeight: 44 }} value={query} onChange={event => setQuery(event.target.value)} placeholder="Digite o nome da paciente" /></div>
          {query.trim().length >= 2 && <div className="card" style={{ marginTop: 4, padding: 4, maxHeight: 220, overflowY: 'auto' }}>
            {loading ? <div className="page-sub" style={{ padding: 10 }}>Buscando…</div> : candidates.length === 0 ? <div className="page-sub" style={{ padding: 10 }}>Nenhuma paciente encontrada.</div> : candidates.map(candidate => <button
              type="button"
              key={candidate.id}
              data-testid={`${idPrefix}-referrer-option`}
              className="btn btn--ghost btn--md"
              style={{ width: '100%', justifyContent: 'flex-start', minHeight: 44, textAlign: 'left' }}
              onClick={() => { setSelected(candidate); setQuery(''); onChange({ ...value, referredByPatientId: candidate.id, referrerName: null }); }}
            ><span><strong>{candidate.name}</strong>{candidate.archived_at && <span style={{ marginLeft: 6, fontSize: 11 }}>(arquivada)</span>}{candidate.phone && <span className="page-sub" style={{ display: 'block' }}>{candidate.phone}</span>}</span></button>) }
          </div>}
        </>}
      </div> : <div className="field">
        <label className="field-label" htmlFor={`${idPrefix}-referrer-name`}>Nome de quem indicou</label>
        <input id={`${idPrefix}-referrer-name`} data-testid={`${idPrefix}-referrer-name`} className="field-input" value={value.referrerName ?? ''} onChange={event => onChange({ ...value, referrerName: event.target.value, referredByPatientId: null })} placeholder="Ex.: Fernanda Souza" style={{ minHeight: 44 }} />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Não cria uma paciente automaticamente.</span>
      </div>}
      {!value.referredByPatientId && !value.referrerName?.trim() && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Se não souber quem indicou, pode salvar apenas como Indicação.</span>}
    </div>}

    {value.source && ACQUISITION_DETAIL_SOURCES.includes(value.source) && <div className="field">
      <label className="field-label" htmlFor={`${idPrefix}-detail`}>{detailLabel}</label>
      <input id={`${idPrefix}-detail`} data-testid={`${idPrefix}-detail`} className="field-input" value={value.sourceDetail ?? ''} onChange={event => onChange({ ...value, sourceDetail: event.target.value })} placeholder={value.source === 'partnership' ? 'Ex.: Clara Clippero Beauty Spa' : value.source === 'campaign' ? 'Ex.: Dia das Mães' : 'Ex.: Evento X'} style={{ minHeight: 44 }} />
    </div>}
  </div>;
}
