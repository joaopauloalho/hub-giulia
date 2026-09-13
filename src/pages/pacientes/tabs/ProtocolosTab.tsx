import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ClipboardPlus, Loader2, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePatientEntitlements, usePatientPackages } from '../../../hooks/usePackages';
import { useProcedures } from '../../../hooks/useProcedures';
import { supabase } from '../../../lib/supabase';
import { completedTreatmentSessions, effectiveTreatmentTotal, remainingTreatmentSessions } from '../../../lib/treatmentExecution';
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

export function ProtocolosTab({ patientId }: { patientId: string }) {
  const navigate = useNavigate();
  const { data: entitlements, loading: loadingEntitlements } = usePatientEntitlements(patientId);
  const { ledger, loading: loadingPackages } = usePatientPackages(patientId);
  const { procedures, loading: loadingProcedures } = useProcedures(patientId);
  const [meta, setMeta] = useState<Record<string, ProtocolMeta>>({});
  const [loadingMeta, setLoadingMeta] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoadingMeta(true);
    void supabase
      .from('patient_packages')
      .select('id,commercial_total_snapshot,estimated_cost_snapshot,activated_at,created_at')
      .eq('patient_id', patientId)
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          console.warn('[patient-protocols:meta]', error);
          setMeta({});
          return;
        }
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
      })
      .finally(() => { if (alive) setLoadingMeta(false); });
    return () => { alive = false; };
  }, [patientId]);

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

  const loading = loadingEntitlements || loadingPackages || loadingProcedures || loadingMeta;
  if (loading) return <div className="loading-state"><Loader2 size={18} className="spin" /> Carregando protocolos…</div>;

  if (!groups.length) {
    return <div className="empty-state" style={{ padding: 26 }}>
      <WalletCards size={28} style={{ marginBottom: 8 }} />
      <strong style={{ display: 'block', marginBottom: 5 }}>Nenhum protocolo vinculado</strong>
      <span>Quando um combo/protocolo for contratado, ele aparecerá aqui e as sessões continuarão sendo registradas em Atendimento.</span>
    </div>;
  }

  return <div style={{ display: 'grid', gap: 14 }}>
    <div style={{ padding: '2px 2px 6px' }}>
      <strong style={{ display: 'block', fontSize: '1rem' }}>Protocolos da paciente</strong>
      <span className="page-sub">O protocolo agrupa as sessões. Cada visita continua sendo um atendimento normal, sem cobrar novamente o que já foi pago.</span>
    </div>

    {groups.map(group => {
      const protocolMeta = meta[group.packageId];
      const linkedIds = activeRedemptionProcedureIds.get(group.packageId) ?? new Set<string>();
      const sessions = [...linkedIds]
        .map(id => procedureById.get(id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
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
