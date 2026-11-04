import { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useServicos } from '../../hooks/useServicos';
import { useToast } from '../../hooks/useToast';
import type { Service } from '../../types';

type FollowUpService = Service & {
  return_enabled?: boolean;
  return_type?: 'clinical_return' | 'next_session' | null;
};

export function ServiceReturnSettings() {
  const { servicos, refresh } = useServicos();
  const { toast } = useToast();
  const [editing, setEditing] = useState<FollowUpService | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [type, setType] = useState<'clinical_return' | 'next_session'>('clinical_return');
  const [startDays, setStartDays] = useState('');
  const [endDays, setEndDays] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setEnabled(editing.return_enabled ?? false);
    setType(editing.return_type ?? 'clinical_return');
    setStartDays(editing.return_min_days?.toString() ?? '');
    setEndDays(editing.return_max_days?.toString() ?? '');
  }, [editing]);

  const save = async () => {
    if (!editing) return;
    const start = startDays === '' ? null : Number(startDays);
    const end = endDays === '' ? null : Number(endDays);
    if (enabled && (start === null || end === null || start < 0 || end < start)) {
      toast.error('Informe uma janela válida de acompanhamento.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('services').update({
        return_enabled: enabled,
        return_type: enabled ? type : editing.return_type ?? null,
        return_min_days: start,
        return_max_days: end,
      }).eq('id', editing.id);
      if (error) throw error;
      await refresh();
      setEditing(null);
      toast.success('Regra de acompanhamento atualizada.');
    } catch (error) {
      console.error('[catalogo] return rule update failed', error);
      toast.error('Não foi possível atualizar o acompanhamento.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" style={{ marginTop: '16px', padding: '18px' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div><h2 className="card-title" style={{ margin: 0 }}>Acompanhamento após o procedimento</h2><p className="page-sub">Defina quais serviços geram retorno clínico ou recomendação de nova sessão.</p></div>
        <RotateCcw size={20} color="var(--primary)" />
      </div>
      <div style={{ display: 'grid', gap: '8px' }}>
        {servicos.map(service => {
          const row = service as FollowUpService;
          const active = row.return_enabled ?? false;
          return (
            <button key={row.id} className="card" style={{ textAlign: 'left', padding: '12px', cursor: 'pointer' }} onClick={() => setEditing(row)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                <strong>{row.name}</strong>
                <span className={`badge ${active ? 'badge--green' : 'badge--gray'}`}>{active ? 'Ativo' : 'Desativado'}</span>
              </div>
              <div className="page-sub" style={{ marginTop: '4px' }}>
                {active
                  ? `${row.return_type === 'next_session' ? 'Nova sessão' : 'Retorno clínico'} · ${row.return_min_days}–${row.return_max_days} dias`
                  : row.return_min_days !== null || row.return_max_days !== null
                    ? `Regra antiga preservada: ${row.return_min_days ?? '—'}–${row.return_max_days ?? '—'} dias (não gera novos retornos)`
                    : 'Sem acompanhamento configurado'}
              </div>
            </button>
          );
        })}
      </div>

      {editing && (
        <div className="drawer-overlay" onClick={() => !saving && setEditing(null)}>
          <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="follow-up-settings-title" onClick={event => event.stopPropagation()}>
            <div className="drawer-header">
              <div><h2 className="drawer-title" id="follow-up-settings-title">Acompanhamento</h2><p className="page-sub">{editing.name}</p></div>
              <button className="icon-btn" onClick={() => setEditing(null)} disabled={saving} aria-label="Fechar"><X size={20} /></button>
            </div>
            <div className="drawer-body" style={{ display: 'grid', gap: '14px' }}>
              <label style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />
                <span><strong>Ativar acompanhamento</strong><span className="page-sub" style={{ display: 'block' }}>Só novos procedimentos usarão esta regra.</span></span>
              </label>
              {enabled && <>
                <div><label className="field-label">Tipo</label><select className="field-input" value={type} onChange={event => setType(event.target.value as typeof type)}><option value="clinical_return">Retorno clínico</option><option value="next_session">Nova sessão</option></select></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div><label className="field-label">Quando começa</label><input className="field-input" type="number" min="0" value={startDays} onChange={event => setStartDays(event.target.value)} /><span className="page-sub">dias</span></div>
                  <div><label className="field-label">Prazo/recomendação até</label><input className="field-input" type="number" min="0" value={endDays} onChange={event => setEndDays(event.target.value)} /><span className="page-sub">dias</span></div>
                </div>
              </>}
            </div>
            <div className="drawer-footer"><button className="btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancelar</button><button className="btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar acompanhamento'}</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
