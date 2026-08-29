import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Plus, Search, Sparkles, WalletCards } from 'lucide-react';
import type { Service } from '../../types';
import type { PatientEntitlement } from '../../types/packages';
import { groupActiveTreatmentPlans, treatmentProgressLabel, treatmentSessionLabel } from '../../lib/treatmentExecution';
import './treatment-execution.css';

type Props = {
  catalogServices: Service[];
  loadingServices: boolean;
  selected: Service[];
  entitlements: PatientEntitlement[];
  loadingEntitlements: boolean;
  coverageByService: Record<string, string | undefined>;
  onTreatmentToggle: (service: Service, entitlement: PatientEntitlement) => void;
  onExtraToggle: (service: Service) => void;
};

function money(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function TreatmentExecutionStep({ catalogServices, loadingServices, selected, entitlements, loadingEntitlements, coverageByService, onTreatmentToggle, onExtraToggle }: Props) {
  const plans = useMemo(() => groupActiveTreatmentPlans(entitlements), [entitlements]);
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [query, setQuery] = useState('');
  const servicesById = useMemo(() => new Map(catalogServices.map(service => [service.id, service])), [catalogServices]);
  const hasPlans = plans.length > 0;
  const showExtras = extrasOpen || !hasPlans;
  const selectedIds = useMemo(() => new Set(selected.map(service => service.id)), [selected]);
  const filteredExtras = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return catalogServices.filter(service => service.active && (!normalized || service.name.toLocaleLowerCase('pt-BR').includes(normalized)));
  }, [catalogServices, query]);
  const coveredCount = Object.keys(coverageByService).length;
  const extraCount = selected.filter(service => !coverageByService[service.id]).length;

  const planContent = loadingEntitlements ? (
    <div className="treatment-execution__loading"><Loader2 size={20} className="spin"/> Verificando tratamentos ativos…</div>
  ) : hasPlans ? (
    <div className="treatment-plan-list">
      {plans.map(plan => {
        const progressPct = plan.totalSessions > 0 ? Math.min(100, (plan.completedSessions / plan.totalSessions) * 100) : 0;
        return <section className="treatment-plan" key={plan.packageId}>
          <header className="treatment-plan__header">
            <div className="treatment-plan__icon"><WalletCards size={18}/></div>
            <div className="treatment-plan__title-wrap"><strong>{plan.title}</strong><span>{plan.completedSessions.toLocaleString('pt-BR')} de {plan.totalSessions.toLocaleString('pt-BR')} sessões realizadas · {plan.remainingSessions.toLocaleString('pt-BR')} restantes</span></div>
            <span className="treatment-plan__paid">Já pago</span>
          </header>
          <div className="treatment-plan__progress" aria-hidden="true"><span style={{ width: `${progressPct}%` }}/></div>
          <div className="treatment-plan__items">
            {plan.items.map(item => {
              const service = item.service_id ? servicesById.get(item.service_id) : undefined;
              const selectedHere = Boolean(item.service_id && coverageByService[item.service_id] === item.package_item_id);
              const selectable = Boolean(service?.active && item.available_balance >= 1);
              return <button key={item.package_item_id} type="button" className={`treatment-session${selectedHere ? ' treatment-session--selected' : ''}`} onClick={() => { if (service && selectable) onTreatmentToggle(service, item); }} disabled={!selectable} aria-pressed={selectedHere}>
                <span className="treatment-session__check">{selectedHere ? <Check size={15} strokeWidth={3}/> : null}</span>
                <span className="treatment-session__main"><strong>{item.service_name_snapshot}</strong><span>{treatmentProgressLabel(item)}</span>{!service && <small>Serviço original não está mais disponível no catálogo.</small>}{service && !service.active && <small>Serviço inativo no catálogo.</small>}</span>
                <span className="treatment-session__next"><small>{selectedHere ? 'Selecionado para hoje' : 'Próxima'}</small><strong>{treatmentSessionLabel(item)}</strong></span>
              </button>;
            })}
          </div>
        </section>;
      })}
    </div>
  ) : (
    <div className="treatment-execution__empty"><strong>Nenhum tratamento com sessões disponíveis</strong><span>Selecione abaixo o procedimento avulso realizado hoje.</span></div>
  );

  const extrasContent = showExtras ? (
    <section className="treatment-execution__extras">
      <div className="treatment-execution__extras-copy"><strong>{hasPlans ? 'Procedimento extra' : 'Procedimentos'}</strong><span>{hasPlans ? 'Itens selecionados aqui entram como cobrança adicional.' : 'Escolha o que foi realizado hoje.'}</span></div>
      <div className="treatment-execution__search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar procedimento…" aria-label="Buscar procedimento"/></div>
      {loadingServices ? <div className="treatment-execution__loading"><Loader2 size={20} className="spin"/> Carregando catálogo…</div> : <div className="treatment-extra-list">
        {filteredExtras.map(service => {
          const selectedExtra = selectedIds.has(service.id) && !coverageByService[service.id];
          const coveredElsewhere = Boolean(coverageByService[service.id]);
          return <button key={service.id} type="button" className={`treatment-extra${selectedExtra ? ' treatment-extra--selected' : ''}`} onClick={() => { if (!coveredElsewhere) onExtraToggle(service); }} disabled={coveredElsewhere} aria-pressed={selectedExtra}>
            <span className="treatment-extra__check">{selectedExtra ? <Check size={14} strokeWidth={3}/> : null}</span>
            <span className="treatment-extra__name"><strong>{service.name}</strong><small>{service.type === 'combo' ? 'Combo avulso' : 'Procedimento avulso'}</small></span>
            <strong className="treatment-extra__price">{coveredElsewhere ? 'No tratamento' : money(service.price)}</strong>
          </button>;
        })}
        {filteredExtras.length === 0 && <div className="treatment-execution__empty"><span>Nenhum procedimento encontrado.</span></div>}
      </div>}
    </section>
  ) : null;

  return <div className="treatment-execution">
    <div className="treatment-execution__heading"><div><span className="treatment-execution__eyebrow"><Sparkles size={14}/> Atendimento de hoje</span><h2>O que foi realizado hoje?</h2><p>Tratamentos já pagos aparecem primeiro. Selecione somente as sessões feitas hoje; o Hub controla a sequência e não cobra novamente.</p></div>{(coveredCount > 0 || extraCount > 0) && <div className="treatment-execution__selection-summary" aria-live="polite">{coveredCount > 0 && <span>{coveredCount} do tratamento</span>}{extraCount > 0 && <span>{extraCount} extra{extraCount === 1 ? '' : 's'}</span>}</div>}</div>
    {planContent}
    {hasPlans && <button type="button" className="treatment-execution__extras-toggle" onClick={() => setExtrasOpen(value => !value)} aria-expanded={showExtras}><span><Plus size={16}/> Adicionar procedimento fora do tratamento</span>{showExtras ? <ChevronDown size={17}/> : <ChevronRight size={17}/>}</button>}
    {extrasContent}
  </div>;
}
