import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, ClipboardPlus, Link2, Loader2, Pencil, Save, WalletCards, X } from 'lucide-react';
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
  title_snapshot: string;
  commercial_total_snapshot: number;
  estimated_cost_snapshot: number | null;
  initial_estimated_cost_snapshot: number | null;
  valid_from: string | null;
  activated_at: string | null;
  created_at: string;
  notes: string | null;
  source_procedure_id: string | null;
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

type ProtocolEditDraft = {
  title: string;
  validFrom: string;
  estimatedCost: string;
  notes: string;
  totals: Record<string, string>;
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

function isoDate(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(0, 10);
}

export function ProtocolosTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: entitlements, loading: loadingEntitlements, refresh: refreshEntitlements } = usePatientEntitlements(patientId);
  const { ledger, loading: loadingPackages, refresh: refreshPackages } = usePatientPackages(patientId);
  const { procedures, loading: loadingProcedures, refresh: refreshProcedures } = useProcedures(patientId);
  const [meta, setMeta] = useState<Record<string, ProtocolMeta>>({});
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [legacyCandidates, setLegacyCandidates] = useState<LegacyProtocolCandidate[]>([]);
  const [loadingLegacy, setLoadingLegacy] = useState(true);
  const [legacyDrafts, setLegacyDrafts] = useState<Record<string, LegacyDraft>>({});
  const [linkingLegacyKey, setLinkingLegacyKey] = useState<string | null>(null);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProtocolEditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoadingMeta(true);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('patient_packages')
          .select('id,title_snapshot,commercial_total_snapshot,estimated_cost_snapshot,initial_estimated_cost_snapshot,valid_from,activated_at,created_at,notes,source_procedure_id')
          .eq('patient_id', patientId);
        if (error) throw error;
        if (!alive) return;
        const next: Record<string, ProtocolMeta> = {};
        for (const row of data ?? []) {
          next[row.id] = {
            id: row.id,
            title_snapshot: row.title_snapshot,
            commercial_total_snapshot: Number(row.commercial_total_snapshot ?? 0),
            estimated_cost_snapshot: row.estimated_cost_snapshot == null ? null : Number(row.estimated_cost_snapshot),
            initial_estimated_cost_snapshot: row.initial_estimated_cost_snapshot == null ? null : Number(row.initial_estimated_cost_snapshot),
            valid_from: row.valid_from ?? null,
            activated_at: row.activated_at ?? null,
            created_at: row.created_at,
            notes: row.notes ?? null,
            source_procedure_id: row.source_procedure_id ?? null,
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

  const startEditing = (group: ProtocolGroup) => {
    const protocolMeta = meta[group.packageId];
    if (!protocolMeta) return;
    setEditingPackageId(group.packageId);
    setEditDraft({
      title: protocolMeta.title_snapshot || group.title,
      validFrom: isoDate(protocolMeta.valid_from ?? protocolMeta.created_at),
      estimatedCost: String(protocolMeta.estimated_cost_snapshot ?? protocolMeta.initial_estimated_cost_snapshot ?? 0),
      notes: protocolMeta.notes ?? '',
      totals: Object.fromEntries(group.items.map(item => [item.package_item_id, String(effectiveTreatmentTotal(item))])),
    });
  };

  const cancelEditing = () => {
    setEditingPackageId(null);
    setEditDraft(null);
  };

  const saveProtocolPlan = async (group: ProtocolGroup) => {
    if (!editDraft) return;
    const estimatedCost = Number(editDraft.estimatedCost.replace(',', '.'));
    if (!editDraft.title.trim()) return toast.error('Informe o nome do protocolo.');
    if (!editDraft.validFrom) return toast.error('Informe a data de início/contratação.');
    if (!Number.isFinite(estimatedCost) || estimatedCost < 0) return toast.error('Informe um custo previsto válido.');

    for (const item of group.items) {
      const total = Number(editDraft.totals[item.package_item_id]?.replace(',', '.'));
      const completed = completedTreatmentSessions(item);
      if (!Number.isFinite(total) || total <= 0) return toast.error(`Informe um total válido para ${item.service_name_snapshot}.`);
      if (total + 0.0001 < completed) return toast.error(`O total de ${item.service_name_snapshot} não pode ser menor que ${quantity(completed)} já realizada(s).`);
    }

    setSavingEdit(true);
    try {
      const { error: planError } = await supabase.rpc('update_patient_protocol_plan_v1', {
        p_package_id: group.packageId,
        p_title: editDraft.title.trim(),
        p_valid_from: editDraft.validFrom,
        p_estimated_cost: estimatedCost,
        p_notes: editDraft.notes.trim() || null,
      });
      if (planError) throw planError;

      for (const item of group.items) {
        const desiredTotal = Number(editDraft.totals[item.package_item_id]?.replace(',', '.'));
        if (Math.abs(desiredTotal - effectiveTreatmentTotal(item)) < 0.0001) continue;
        const { error: totalError } = await supabase.rpc('set_patient_protocol_item_total_v1', {
          p_package_item_id: item.package_item_id,
          p_total: desiredTotal,
          p_reason: 'Atualização manual do planejamento do protocolo',
          p_idempotency_key: crypto.randomUUID(),
        });
        if (totalError) throw totalError;
      }

      await Promise.all([refreshEntitlements(), refreshPackages(), refreshProcedures()]);
      setReloadKey(current => current + 1);
      cancelEditing();
      toast.success('Protocolo atualizado. A previsão não movimenta o caixa; os custos reais continuam vindo das sessões.');
    } catch (error) {
      console.error('[patient-protocols:update-plan]', error);
      const raw = error instanceof Error ? error.message : String(error ?? '');
      if (raw.includes('PROTOCOL_TOTAL_BELOW_COMPLETED')) toast.error('Não é possível reduzir o total abaixo do número de sessões já realizadas.');
      else toast.error('Não foi possível atualizar o protocolo.');
    } finally {
      setSavingEdit(false);
    }
  };

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
              <input className="field-input" type="number" inputMode="numeric" min="1" step="1" placeholder="Ex.: 6" value={draft.totalSessions} onChange={event => setLegacyDrafts(current => ({ ...current, [key]: { ...draft, totalSessions: event.target.value } }))}/>
              <small className="page-sub">Como esse protocolo antigo não tinha composição cadastrada, informe o total combinado com a paciente.</small>
            </div>}
            <div>
              <label className="field-label">Sessões já realizadas</label>
              <input className="field-input" type="number" inputMode="numeric" min="0" max={maxSessions > 0 ? maxSessions : undefined} step="1" value={draft.completedSessions} onChange={event => setLegacyDrafts(current => ({ ...current, [key]: { ...draft, completedSessions: event.target.value } }))}/>
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
      const purchasedAt = protocolMeta?.valid_from ?? protocolMeta?.activated_at ?? protocolMeta?.created_at ?? null;
      const statusLabel = group.active ? 'Em andamento' : group.remaining <= 0 && group.completed > 0 ? 'Concluído' : 'Sem sessões disponíveis';
      const currentForecast = protocolMeta?.estimated_cost_snapshot ?? null;
      const initialForecast = protocolMeta?.initial_estimated_cost_snapshot ?? currentForecast;
      const forecastRemaining = currentForecast == null ? null : currentForecast - realizedCost;
      const predictedMargin = currentForecast == null || !protocolMeta ? null : protocolMeta.commercial_total_snapshot - currentForecast;
      const editing = editingPackageId === group.packageId && editDraft != null;

      const registerSession = () => {
        const query = new URLSearchParams({ patient_id: patientId });
        if (nextItem?.service_id) query.set('service_id', nextItem.service_id);
        navigate(`/registrar?${query.toString()}`, {
          state: { patientId, serviceId: nextItem?.service_id ?? null, from: `/pacientes/${patientId}` },
        });
      };

      return <section key={group.packageId} style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'var(--bg-2)', overflow: 'hidden' }}>
        <div style={{ padding: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '.96rem' }}>{protocolMeta?.title_snapshot || group.title}</strong>
              <span className={`badge ${group.active ? 'badge--green' : ''}`} style={!group.active ? { background: 'var(--bg-3)', color: 'var(--text-2)' } : undefined}>{statusLabel}</span>
              {group.sourceType === 'complimentary' && <span className="badge" style={{ background: '#fce7f3', color: '#9d174d' }}>Cortesia</span>}
            </div>
            {purchasedAt && <span className="page-sub" style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}><CalendarDays size={13} /> Iniciado em {new Date(`${isoDate(purchasedAt)}T12:00:00`).toLocaleDateString('pt-BR')}</span>}
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {!editing && <button type="button" className="btn btn--ghost btn--sm" onClick={() => startEditing(group)} disabled={!protocolMeta}><Pencil size={14} /> Editar protocolo</button>}
            {group.active && <button type="button" className="btn btn--primary btn--sm" onClick={registerSession} disabled={!nextItem}><ClipboardPlus size={15} /> Registrar nova sessão</button>}
          </div>
        </div>

        <div style={{ padding: 15 }}>
          {editing && editDraft && <div style={{ marginBottom: 14, padding: 14, border: '1px solid #f9a8d4', borderRadius: 12, background: '#fff7fb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div><strong>Editar planejamento do protocolo</strong><div className="page-sub">Ajustar previsão ou número de sessões não cria cobrança e não movimenta o caixa.</div></div>
              <button type="button" className="icon-btn" onClick={cancelEditing} disabled={savingEdit} aria-label="Fechar edição"><X size={18}/></button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
              <div><label className="field-label">Nome do protocolo</label><input className="field-input" value={editDraft.title} onChange={event => setEditDraft(current => current ? { ...current, title: event.target.value } : current)}/></div>
              <div><label className="field-label">Data de início/contratação</label><input className="field-input" type="date" value={editDraft.validFrom} onChange={event => setEditDraft(current => current ? { ...current, validFrom: event.target.value } : current)}/></div>
              <div><label className="field-label">Previsão atual do custo completo</label><input className="field-input" type="number" inputMode="decimal" min="0" step="0.01" value={editDraft.estimatedCost} onChange={event => setEditDraft(current => current ? { ...current, estimatedCost: event.target.value } : current)}/><small className="page-sub">É uma previsão gerencial. O custo real continua vindo de cada atendimento.</small></div>
            </div>
            <div style={{ marginTop: 11 }}><label className="field-label">Observação do protocolo</label><textarea className="field-input" rows={2} value={editDraft.notes} onChange={event => setEditDraft(current => current ? { ...current, notes: event.target.value } : current)} placeholder="Opcional…"/></div>
            <div style={{ marginTop: 12 }}>
              <strong style={{ display: 'block', fontSize: '.8rem', marginBottom: 7 }}>Total planejado de sessões</strong>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 8 }}>
                {group.items.map(item => <div key={item.package_item_id} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-1)' }}>
                  <label className="field-label">{item.service_name_snapshot}</label>
                  <input className="field-input" type="number" inputMode="decimal" min={completedTreatmentSessions(item)} step="1" value={editDraft.totals[item.package_item_id] ?? ''} onChange={event => setEditDraft(current => current ? { ...current, totals: { ...current.totals, [item.package_item_id]: event.target.value } } : current)}/>
                  <small className="page-sub">Já realizadas: {quantity(completedTreatmentSessions(item))}. Você pode aumentar o total a qualquer momento.</small>
                </div>)}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn--ghost btn--sm" onClick={cancelEditing} disabled={savingEdit}>Cancelar</button>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => void saveProtocolPlan(group)} disabled={savingEdit}>{savingEdit ? <Loader2 size={14} className="spin" /> : <Save size={14}/>} {savingEdit ? 'Salvando…' : 'Salvar alterações'}</button>
            </div>
          </div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8 }}>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Valor contratado</small><strong style={{ display: 'block', marginTop: 3 }}>{protocolMeta ? money(protocolMeta.commercial_total_snapshot) : '—'}</strong></div>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Previsão inicial</small><strong style={{ display: 'block', marginTop: 3 }}>{initialForecast == null ? '—' : money(initialForecast)}</strong></div>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Previsão atual</small><strong style={{ display: 'block', marginTop: 3 }}>{currentForecast == null ? '—' : money(currentForecast)}</strong></div>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Custo realizado</small><strong style={{ display: 'block', marginTop: 3 }}>{money(realizedCost)}</strong></div>
            <div style={{ padding: 10, borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--border)' }}><small className="page-sub">Sessões</small><strong style={{ display: 'block', marginTop: 3 }}>{quantity(group.completed)} de {quantity(group.total)}</strong></div>
          </div>

          <div style={{ marginTop: 10, padding: 11, borderRadius: 10, border: `1px solid ${forecastRemaining != null && forecastRemaining < 0 ? '#fecaca' : '#bbf7d0'}`, background: forecastRemaining != null && forecastRemaining < 0 ? '#fff7f7' : '#f7fff9', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.76rem' }}><strong>Previsão não é saída de caixa.</strong> O custo realizado acima soma apenas os atendimentos/sessões efetivamente registrados.</span>
            {forecastRemaining != null && <strong style={{ fontSize: '.76rem', color: forecastRemaining < 0 ? '#b91c1c' : '#166534' }}>{forecastRemaining < 0 ? `${money(Math.abs(forecastRemaining))} acima da previsão` : `${money(forecastRemaining)} ainda previstos`}</strong>}
          </div>
          {predictedMargin != null && <div className="page-sub" style={{ marginTop: 6 }}>Resultado bruto previsto do protocolo: <strong>{money(predictedMargin)}</strong> antes de despesas gerais e taxas.</div>}

          <div style={{ height: 7, borderRadius: 999, background: 'var(--bg-3)', overflow: 'hidden', marginTop: 12 }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--primary)', borderRadius: 999 }} /></div>
          <div className="page-sub" style={{ marginTop: 5 }}>{quantity(group.remaining)} sessão{group.remaining === 1 ? '' : 'ões'} restante{group.remaining === 1 ? '' : 's'}</div>

          <div style={{ display: 'grid', gap: 6, marginTop: 13 }}>
            {group.items.map(item => <div key={item.package_item_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-1)', border: '1px solid var(--border)' }}>
              <span><strong style={{ display: 'block', fontSize: '.79rem' }}>{item.service_name_snapshot}</strong><small className="page-sub">{quantity(completedTreatmentSessions(item))} de {quantity(effectiveTreatmentTotal(item))} realizadas</small></span>
              {remainingTreatmentSessions(item) <= 0 ? <CheckCircle2 size={17} style={{ color: '#15803d', flexShrink: 0 }} /> : <strong style={{ fontSize: '.76rem', whiteSpace: 'nowrap' }}>{quantity(remainingTreatmentSessions(item))} restantes</strong>}
            </div>)}
          </div>

          {protocolMeta?.notes && !editing && <div style={{ marginTop: 12, padding: 10, borderRadius: 9, background: 'var(--bg-1)', border: '1px solid var(--border)', fontSize: '.76rem' }}><strong>Observação</strong><div className="page-sub" style={{ marginTop: 3, whiteSpace: 'pre-wrap' }}>{protocolMeta.notes}</div></div>}

          {sessions.length > 0 && <div style={{ marginTop: 15, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <strong style={{ display: 'block', fontSize: '.8rem', marginBottom: 7 }}>Atendimentos deste protocolo</strong>
            <div style={{ display: 'grid', gap: 5 }}>
              {sessions.slice(0, 10).map(session => <button key={session.id} type="button" onClick={() => navigate(`/registrar?edit=${session.id}`)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '88px minmax(0,1fr) auto auto', gap: 8, alignItems: 'center', padding: '7px 8px', border: '1px solid transparent', borderRadius: 8, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', fontSize: '.75rem' }}>
                <span className="page-sub">{new Date(session.performed_at).toLocaleDateString('pt-BR')}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.items?.map(item => item.name).join(' + ') || 'Atendimento'}</span>
                <strong>{money(Number(session.total_cost || 0))}</strong>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--primary)', fontWeight: 700 }}><Pencil size={12}/> Editar</span>
              </button>)}
            </div>
            <small className="page-sub" style={{ display: 'block', marginTop: 7 }}>Para corrigir o custo real, abra o atendimento correspondente. O protocolo recalcula o acumulado automaticamente.</small>
          </div>}
        </div>
      </section>;
    })}
  </div>;
}
