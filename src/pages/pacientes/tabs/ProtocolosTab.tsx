import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, ClipboardPlus, Link2, Loader2, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePatientEntitlements, usePatientPackages } from '../../../hooks/usePackages';
import { useProcedures } from '../../../hooks/useProcedures';
import { useToast } from '../../../hooks/useToast';
import { supabase } from '../../../lib/supabase';
import { completedTreatmentSessions, effectiveTreatmentTotal, remainingTreatmentSessions } from '../../../lib/treatmentExecution';
import type { Procedure } from '../../../types';
import type { PatientEntitlement } from '../../../types/packages';

const money = (value: number) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quantity = (value: number) => Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

type ProtocolMeta = {
  id: string;
  commercial_total_snapshot: number;
  estimated_cost_snapshot: number | null;
  activated_at: string | null;
  created_at: string;
};

type ProtocolGroup = {
  packageId: string;
  title: string;
  sourceType: PatientEntitlement['source_type'];
  items: PatientEntitlement[];
  total: number;
  completed: number;
  remaining: number;
  active: boolean;
};

type LegacyProtocolCandidate = {
  patient_id: string;
  procedure_id: string;
  performed_at: string;
  procedure_item_id: string;
  service_id: string;
  service_name_snapshot: string;
  qty: number;
  final_price: number;
  cost_snapshot: number;
  catalog_estimated_cost: number;
  component_count: number;
  planned_sessions: number | null;
};

type LegacyDraft = {
  totalSessions: string;
  completedSessions: string;
};

function groupProtocols(entitlements: PatientEntitlement[]) {
  const grouped = new Map<string, PatientEntitlement[]>();
  for (const item of entitlements) {
    if (item.source_type === 'voucher') continue;
    grouped.set(item.package_id, [...(grouped.get(item.package_id) ?? []), item]);
  }

  return [...grouped.entries()].map(([packageId, items]): ProtocolGroup => {
    const total = items.reduce((sum, item) => sum + effectiveTreatmentTotal(item), 0);
    const completed = items.reduce((sum, item) => sum + completedTreatmentSessions(item), 0);
    const remaining = items.reduce((sum, item) => sum + remainingTreatmentSessions(item), 0);
    return {
      packageId,
      title: items[0]?.package_title ?? 'Protocolo',
      sourceType: items[0]?.source_type ?? 'manual',
      items,
      total,
      completed,
      remaining,
      active: items.some(item => item.effective_status === 'active') && remaining > 0,
    };
  }).sort((a, b) => Number(b.active) - Number(a.active) || a.title.localeCompare(b.title, 'pt-BR'));
}

function legacyKey(candidate: LegacyProtocolCandidate) {
  return `${candidate.procedure_id}:${candidate.service_id}`;
}

export function ProtocolosTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: entitlements, loading: loadingEntitlements, refresh: refreshEntitlements } = usePatientEntitlements(patientId);
  const { ledger, loading: loadingPackages, refresh: refreshPackages } = usePatientPackages(patientId);
  const { procedures, loading: loadingProcedures } = useProcedures(patientId);
  const [meta, setMeta] = useState<Record<string, ProtocolMeta>>({});
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [legacyCandidates, setLegacyCandidates] = useState<LegacyProtocolCandidate[]>([]);
  const [loadingLegacy, setLoadingLegacy] = useState(true);
  const [legacyDrafts, setLegacyDrafts] = useState<Record<string, LegacyDraft>>({});
  const [linkingLegacyKey, setLinkingLegacyKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoadingMeta(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('patient_packages')
          .select('id,commercial_total_snapshot,estimated_cost_snapshot,activated_at,created_at')
          .eq('patient_id', patientId);
        if (error) throw error;
        if (!alive) return;
        const next: Record<string, ProtocolMeta> = {};
        for (const row of data ?? []) {
          next[row.id] = {
            id: row.id,
            commercial_total_snapshot: Number(row.commercial_total_snapshot ?? 0),
            estimated_cost_snapshot: row.estimated_cost_snapshot == null ? null : Number(row.estimated_cost_snapshot),
            activated_at: row.activated_at ?? null,
            created_at: row.created_at,
          };
        }
        setMeta(next);
      } catch (error) {
        if (!alive) return;
        console.warn('[patient-protocols:meta]', error);
        setMeta({});
      } finally {
        if (alive) setLoadingMeta(false);
      }
    })();
    return () => { alive = false; };
  }, [patientId, reloadKey]);

  useEffect(() => {
    let alive = true;
    setLoadingLegacy(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('patient_legacy_protocol_candidates_v')
          .select('patient_id,procedure_id,performed_at,procedure_item_id,service_id,service_name_snapshot,qty,final_price,cost_snapshot,catalog_estimated_cost,component_count,planned_sessions')
          .eq('patient_id', patientId)
          .order('performed_at', { ascending: false });
        if (error) throw error;
        if (!alive) return;
        const normalized = (data ?? []).map(row => ({
          ...row,
          qty: Number(row.qty ?? 1),
          final_price: Number(row.final_price ?? 0),
          cost_snapshot: Number(row.cost_snapshot ?? 0),
          catalog_estimated_cost: Number(row.catalog_estimated_cost ?? 0),
          component_count: Number(row.component_count ?? 0),
          planned_sessions: row.planned_sessions == null ? null : Number(row.planned_sessions),
        })) as LegacyProtocolCandidate[];
        setLegacyCandidates(normalized);
        setLegacyDrafts(current => {
          const next = { ...current };
          for (const candidate of normalized) {
            const key = legacyKey(candidate);
            if (!next[key]) {
              next[key] = {
                totalSessions: candidate.planned_sessions == null ? '' : String(candidate.planned_sessions),
                completedSessions: '1',
              };
            }
          }
          return next;
        });
      } catch (error) {
        if (!alive) return;
        console.warn('[patient-protocols:legacy-candidates]', error);
        setLegacyCandidates([]);
      } finally {
        if (alive) setLoadingLegacy(false);
      }
    })();
    return () => { alive = false; };
  }, [patientId, reloadKey]);

  const groups = useMemo(() => groupProtocols(entitlements), [entitlements]);
  const procedureById = useMemo(() => new Map(procedures.map(procedure => [procedure.id, procedure])), [procedures]);

  const activeRedemptionProcedureIds = useMemo(() => {
    const netByPackageProcedure = new Map<string, number>();
    for (const movement of ledger) {
      if (!movement.procedure_id_snapshot || (movement.movement_type !== 'redeem' && movement.movement_type !== 'reversal')) continue;
      const key = `${movement.package_id}:${movement.procedure_id_snapshot}`;
      netByPackageProcedure.set(key, (netByPackageProcedure.get(key) ?? 0) + Number(movement.quantity_delta));
    }
    const byPackage = new Map<string, Set<string>>();
    for (const [key, net] of netByPackageProcedure) {
      if (net >= -0.0001) continue;
      const separator = key.indexOf(':');
      const packageId = key.slice(0, separator);
      const procedureId = key.slice(separator + 1);
      const current = byPackage.get(packageId) ?? new Set<string>();
      current.add(procedureId);
      byPackage.set(packageId, current);
    }
    return byPackage;
  }, [ledger]);

  const linkLegacyProtocol = async (candidate: LegacyProtocolCandidate) => {
    const key = legacyKey(candidate);
    const draft = legacyDrafts[key] ?? { totalSessions: '', completedSessions: '1' };
    const completedSessions = Math.trunc(Number(draft.completedSessions));
    const structured = candidate.planned_sessions != null && candidate.component_count > 0;
    const totalSessions = structured ? null : Math.trunc(Number(draft.totalSessions));
    const capacity = structured ? Number(candidate.planned_sessions) : Number(totalSessions);

    if (!Number.isFinite(completedSessions) || completedSessions < 0) {
      toast.error('Informe quantas sessões já foram realizadas.');
      return;
    }
    if (!structured && (!Number.isFinite(totalSessions) || Number(totalSessions) < 1)) {
      toast.error('Informe quantas sessões existem no protocolo completo.');
      return;
    }
    if (completedSessions > capacity) {
      toast.error('As sessões realizadas não podem ser maiores que o total do protocolo.');
      return;
    }

    setLinkingLegacyKey(key);
    try {
      const { error } = await supabase.rpc('link_legacy_protocol_from_attendance_v1', {
        p_procedure_id: candidate.procedure_id,
        p_service_id: candidate.service_id,
        p_total_sessions: totalSessions,
        p_completed_sessions: completedSessions,
      });
      if (error) throw error;
      await Promise.all([refreshEntitlements(), refreshPackages()]);
      setReloadKey(current => current + 1);
      toast.success('Protocolo anterior vinculado. A próxima visita pode ser registrada como nova sessão.');
    } catch (error) {
      console.error('[patient-protocols:link-legacy]', error);
      const raw = error instanceof Error ? error.message : String(error ?? '');
      if (raw.includes('LEGACY_PROTOCOL_TOTAL_SESSIONS_REQUIRED')) toast.error('Informe o total de sessões do protocolo.');
      else if (raw.includes('LEGACY_PROTOCOL_COMPLETED_EXCEEDS_TOTAL')) toast.error('As sessões realizadas excedem o total do protocolo.');
      else toast.error('Não foi possível vincular esse protocolo anterior.');
    } finally {
      setLinkingLegacyKey(null);
    }
  };

  const legacyPanel = legacyCandidates.length > 0 ? <section style={{ border: '1px solid #fbcfe8', borderRadius: 14, background: '#fff7fb', overflow: 'hidden' }}>
    <div style={{ padding: 15, borderBottom: '1px solid #fbcfe8', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Link2 size={19} style={{ color: 'var(--primary)', marginTop: 1, flexShrink: 0 }} />
      <div>
        <strong style={{ display: 'block' }}>Vincular protocolo anterior</strong>
        <span className="page-sub">Encontramos atendimento(s) antigo(s) de combo/protocolo. Vincular mantém o pagamento original e não cria uma nova cobrança.</span>
      </div>
    </div>
    <div style={{ display: 'grid', gap: 10, padding: 15 }}>
      {legacyCandidates.map(candidate => {
        const key = legacyKey(candidate);
        const draft = legacyDrafts[key] ?? { totalSessions: '', completedSessions: '1' };
        const structured = candidate.planned_sessions != null && candidate.component_count > 0;
        const maxSessions = structured ? Number(candidate.planned_sessions) : Number(draft.totalSessions || 0);
        const linking = linkingLegacyKey === key;
        return <div key={key} style={{ padding: 13, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong style={{ display: 'block' }}>{candidate.service_name_snapshot}</strong>
              <span className="page-sub">{new Date(candidate.performed_at).toLocaleDateString('pt-BR')} · valor registrado {money(candidate.final_price)}</span>
            </div>
            <span className="badge" style={{ background: '#fce7f3', color: '#9d174d' }}>Atendimento antigo</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 9, marginTop: 12 }}>
            {structured ? <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
              <small className="page-sub">Sessões previstas no catálogo</small>
              <strong style={{ display: 'block', marginTop: 3 }}>{quantity(Number(candidate.planned_sessions))}</strong>
            </div> : <div>
              <label className="field-label">Total de sessões do protocolo</label>
              <input
                className="field-input"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                placeholder="Ex.: 6"
                value={draft.totalSessions}
                onChange={event => setLegacyDrafts(current => ({ ...current, [key]: { ...draft, totalSessions: event.target.value } }))}
              />
              <small className="page-sub">Como esse protocolo antigo não tinha composição cadastrada, informe o total combinado com a paciente.</small>
            </div>}

            <div>
              <label className="field-label">Sessões já realizadas</label>
              <input
                className="field-input"
                type="number"
                inputMode="numeric"
                min="0"
                max={maxSessions > 0 ? maxSessions : undefined}
                step="1"
                value={draft.completedSessions}
                onChange={event => setLegacyDrafts(current => ({ ...current, [key]: { ...draft, completedSessions: event.target.value } }))}
              />
              <small className="page-sub">Inclua a sessão que já aconteceu nesse atendimento antigo. Para a primeira visita, normalmente é 1.</small>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, color: 'var(--text-2)', fontSize: '.73rem' }}>
            <AlertCircle size={14} /> O valor pago e a data original serão preservados. Nenhum recebimento novo será lançado.
          </div>

          <button type="button" className="btn btn--primary btn--md" style={{ marginTop: 12 }} disabled={linking} onClick={() => void linkLegacyProtocol(candidate)}>
            {linking ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />} {linking ? 'Vinculando…' : 'Vincular como protocolo ativo'}
          </button>
        </div>;
      })}
    </div>
  </section> : null;

  const loading = loadingEntitlements || loadingPackages || loadingProcedures || loadingMeta || loadingLegacy;
  if (loading) return <div className="loading-state"><Loader2 size={18} className="spin" /> Carregando protocolos…</div>;

  if (!groups.length) {
    return <div style={{ display: 'grid', gap: 14 }}>
      {legacyPanel}
      {!legacyPanel && <div className="empty-state" style={{ padding: 26 }}>
        <WalletCards size={28} style={{ marginBottom: 8 }} />
        <strong style={{ display: 'block', marginBottom: 5 }}>Nenhum protocolo vinculado</strong>
        <span>Quando um combo/protocolo for contratado, ele aparecerá aqui e as sessões continuarão sendo registradas em Atendimento.</span>
      </div>}
    </div>;
  }

  return <div style={{ display: 'grid', gap: 14 }}>
    <div style={{ padding: '2px 2px 6px' }}>
      <strong style={{ display: 'block', fontSize: '1rem' }}>Protocolos da paciente</strong>
      <span className="page-sub">O protocolo agrupa as sessões. Cada visita continua sendo um atendimento normal, sem cobrar novamente o que já foi pago.</span>
    </div>

    {legacyPanel}

    {groups.map(group => {
      const protocolMeta = meta[group.packageId];
      const linkedIds = activeRedemptionProcedureIds.get(group.packageId) ?? new Set<string>();
      const sessions = [...linkedIds]
        .map(id => procedureById.get(id))
        .filter((row): row is Procedure => Boolean(row))
        .sort((a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime());
      const realizedCost = sessions.reduce((sum, row) => sum + Number(row.total_cost || 0), 0);
      const progress = group.total > 0 ? Math.min(100, group.completed / group.total * 100) : 0;
      const nextItem = group.items.find(item => item.effective_status === 'active' && item.available_balance >= 1 && item.service_id);
      const purchasedAt = protocolMeta?.activated_at ?? protocolMeta?.created_at ?? null;
      const statusLabel = group.active ? 'Em andamento' : group.remaining <= 0 && group.completed > 0 ? 'Concluído' : 'Sem sessões disponíveis';

      const registerSession = () => {
        const query = new URLSearchParams({ patient_id: patientId });
        if (nextItem?.service_id) query.set('service_id', nextItem.service_id);
        navigate(`/registrar?${query.toString()}`, {
          state: {
            patientId,
            serviceId: nextItem?.service_id ?? null,
            from: `/pacientes/${patientId}`,
          },
        });
      };

      return <section key={group.packageId} style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '.96rem' }}>{group.title}</strong>
              <span className={`badge ${group.active ? 'badge--green' : ''}`} style={!group.active ? { background: 'var(--bg-3)', color: 'var(--text-2)' } : undefined}>{statusLabel}</span>
              {group.sourceType === 'complimentary' && <span className="badge" style={{ background: '#fce7f3', color: '#9d174d' }}>Cortesia</span>}
            </div>
            {purchasedAt && <span className="page-sub" style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}><CalendarDays size={13} /> Contratado em {new Date(purchasedAt).toLocaleDateString('pt-BR')}</span>}
          </div>
          {group.active && <button type="button" className="btn btn--primary btn--sm" onClick={registerSession} disabled={!nextItem}><ClipboardPlus size={15} /> Registrar nova sessão</button>}
        </div>

        <div style={{ padding: 15 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8 }}>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Valor contratado</small><strong style={{ display: 'block', marginTop: 3 }}>{protocolMeta ? money(protocolMeta.commercial_total_snapshot) : '—'}</strong></div>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Custo previsto completo</small><strong style={{ display: 'block', marginTop: 3 }}>{protocolMeta?.estimated_cost_snapshot == null ? '—' : money(protocolMeta.estimated_cost_snapshot)}</strong></div>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Custo realizado</small><strong style={{ display: 'block', marginTop: 3 }}>{money(realizedCost)}</strong></div>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Sessões</small><strong style={{ display: 'block', marginTop: 3 }}>{quantity(group.completed)} de {quantity(group.total)}</strong></div>
          </div>

          <div style={{ height: 7, borderRadius: 999, background: 'var(--bg-3)', overflow: 'hidden', marginTop: 12 }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--primary)', borderRadius: 999 }} /></div>
          <div className="page-sub" style={{ marginTop: 5 }}>{quantity(group.remaining)} sessão{group.remaining === 1 ? '' : 'ões'} restante{group.remaining === 1 ? '' : 's'}</div>

          <div style={{ display: 'grid', gap: 6, marginTop: 13 }}>
            {group.items.map(item => <div key={item.package_item_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
              <span><strong style={{ display: 'block', fontSize: '.79rem' }}>{item.service_name_snapshot}</strong><small className="page-sub">{quantity(completedTreatmentSessions(item))} de {quantity(effectiveTreatmentTotal(item))} realizadas</small></span>
              {remainingTreatmentSessions(item) <= 0 ? <CheckCircle2 size={17} style={{ color: '#15803d', flexShrink: 0 }} /> : <strong style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>{quantity(remainingTreatmentSessions(item))} restantes</strong>}
            </div>)}
          </div>

          {sessions.length > 0 && <div style={{ marginTop: 15, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <strong style={{ display: 'block', fontSize: '.8rem', marginBottom: 7 }}>Atendimentos deste protocolo</strong>
            <div style={{ display: 'grid', gap: 5 }}>
              {sessions.slice(0, 6).map(session => <div key={session.id} style={{ display: 'grid', gridTemplateColumns: '88px minmax(0,1fr) auto', gap: 8, alignItems: 'center', fontSize: '.75rem' }}>
                <span className="page-sub">{new Date(session.performed_at).toLocaleDateString('pt-BR')}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.items?.map(item => item.name).join(' + ') || 'Atendimento'}</span>
                <strong>{money(Number(session.total_cost || 0))}</strong>
              </div>)}
            </div>
          </div>}
        </div>
      </section>;
    })}
  </div>;
}
