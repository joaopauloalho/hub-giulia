import { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarPlus, ChevronLeft, ChevronRight, Clock3, MessageCircle, Search, Settings, UserRound, X } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRelationshipCenter } from '../../hooks/useRelationship';
import { buildSafeWhatsAppUrl, whatsappRecipientDigits } from '../../lib/whatsapp';
import { copyCommunicationText, DEFAULT_COMMUNICATION_TEMPLATES, firstName, formatCommunicationDate, renderCommunicationTemplate, type CommunicationPlaceholder } from '../../lib/communications';
import { RELATIONSHIP_TYPE_LABEL, relationshipCreditSummary, relationshipDate, relationshipDateTime, type RelationshipOpportunity, type RelationshipOpportunityType, type RelationshipPerson, type RelationshipPreferences } from '../../lib/relationship';
import { appendReturnTo } from '../../lib/operational';
import { useToast } from '../../hooks/useToast';
import './relationship.css';

const FILTERS: Array<{ key: RelationshipOpportunityType | null; label: string }> = [
  { key: null, label: 'Todas' },
  { key: 'return', label: 'Retornos' },
  { key: 'reschedule', label: 'Reagendar' },
  { key: 'proposal', label: 'Propostas' },
  { key: 'credit', label: 'Créditos' },
  { key: 'reactivation', label: 'Reativação' },
];

function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function addDaysIso(days: number): string {
  const date = new Date(`${localToday()}T12:00:00-03:00`);
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(date);
}

function OpportunityBadge({ opportunity }: { opportunity: RelationshipOpportunity }) {
  return <span className={`relationship-badge relationship-badge--${opportunity.type}`}>{RELATIONSHIP_TYPE_LABEL[opportunity.type]}</span>;
}

function PersonCard({ person, active, onOpen, onWhatsApp, onSnooze }: { person: RelationshipPerson; active: boolean; onOpen: () => void; onWhatsApp: () => void; onSnooze: () => void }) {
  const main = person.opportunities[0];
  return <article className={`relationship-person-card${active ? ' relationship-person-card--active' : ''}`}>
    <button type="button" className="relationship-person-main" onClick={onOpen}>
      <div className="relationship-person-title"><strong>{person.display_name}</strong><span>{person.opportunity_count} motivo{person.opportunity_count === 1 ? '' : 's'}</span></div>
      <div className="relationship-main-reason">{main?.label}</div>
      {person.opportunities.length > 1 && <div className="relationship-badges">{person.opportunities.slice(1, 4).map(item => <OpportunityBadge key={item.key} opportunity={item} />)}</div>}
      <dl className="relationship-meta">
        <div><dt>Último contato</dt><dd>{person.last_contact_at ? relationshipDateTime(person.last_contact_at) : 'Nenhum contato registrado'}</dd></div>
        <div><dt>Último atendimento</dt><dd>{person.last_visit_at ? relationshipDateTime(person.last_visit_at) : 'Nunca atendida'}</dd></div>
        {person.next_appointment_at && <div><dt>Próximo horário</dt><dd>{relationshipDateTime(person.next_appointment_at)}</dd></div>}
      </dl>
    </button>
    <div className="relationship-card-actions">
      <button type="button" className="btn btn--primary btn--sm" onClick={onWhatsApp} disabled={!person.phone}><MessageCircle size={15} /> WhatsApp</button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onOpen}>Abrir</button>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onSnooze}><Bell size={15} /> Lembrar</button>
    </div>
    {!person.phone && <div className="relationship-phone-warning">Sem telefone cadastrado.</div>}
  </article>;
}

function PersonDetail({ person, returnTo, onWhatsApp, onSnooze, onDismiss }: {
  person: RelationshipPerson | null;
  returnTo: string;
  onWhatsApp: (opportunity?: RelationshipOpportunity) => void;
  onSnooze: () => void;
  onDismiss: (opportunity: RelationshipOpportunity) => Promise<void>;
}) {
  const navigate = useNavigate();
  const openRoute = (route: string) => navigate(appendReturnTo(route, returnTo));
  if (!person) return <aside className="relationship-detail relationship-detail--empty"><UserRound size={28} /><strong>Escolha uma pessoa</strong><p className="page-sub">Você verá aqui os motivos atuais e as ações disponíveis.</p></aside>;
  return <aside className="relationship-detail">
    <div className="relationship-detail-head"><div><span className="page-sub">{person.person_type === 'patient' ? 'Paciente' : 'Lead / Contato'}</span><h2>{person.display_name}</h2>{person.phone && <span className="page-sub">{person.phone}</span>}</div><button type="button" className="icon-btn" onClick={() => openRoute(person.target_route)} aria-label="Abrir pessoa"><ChevronRight size={19} /></button></div>
    <div className="relationship-detail-facts">
      <div><span>Último atendimento</span><strong>{person.last_visit_at ? relationshipDateTime(person.last_visit_at) : 'Nunca atendida'}</strong></div>
      <div><span>Último contato</span><strong>{person.last_contact_at ? relationshipDateTime(person.last_contact_at) : 'Nenhum contato registrado'}</strong></div>
      <div><span>Próximo horário</span><strong>{person.next_appointment_at ? relationshipDateTime(person.next_appointment_at) : 'Nenhum'}</strong></div>
    </div>
    <div className="relationship-detail-actions">
      <button type="button" className="btn btn--primary btn--sm" disabled={!person.phone} onClick={() => onWhatsApp()}><MessageCircle size={15} /> WhatsApp</button>
      {person.patient_id && <button type="button" className="btn btn--secondary btn--sm" onClick={() => navigate(`/agenda?patient_id=${person.patient_id}`)}><CalendarPlus size={15} /> Agendar</button>}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onSnooze}><Bell size={15} /> Lembrar depois</button>
    </div>
    <div className="relationship-opportunity-list">
      {person.opportunities.map(opportunity => <section key={opportunity.key} className="relationship-opportunity">
        <div className="relationship-opportunity-head"><OpportunityBadge opportunity={opportunity} /><strong>{opportunity.label}</strong></div>
        {opportunity.type === 'proposal' && opportunity.amount != null && <p>Valor da proposta: <strong>{Number(opportunity.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></p>}
        {opportunity.type === 'credit' && <div className="relationship-credit-items">{opportunity.remaining?.map(item => <div key={item.package_item_id}><span>{item.service_name}</span><strong>{Number(item.balance).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {item.unit_label}</strong></div>)}</div>}
        {opportunity.type === 'reschedule' && <p className="page-sub">{opportunity.context?.appointment_status === 'nao_compareceu' ? 'Não compareceu e ainda não possui novo horário.' : 'Cancelou e ainda não possui novo horário.'}{opportunity.context?.cancellation_reason ? ` Motivo: ${String(opportunity.context.cancellation_reason)}` : ''}</p>}
        {opportunity.expires_on && <p className="page-sub">Validade: {relationshipDate(opportunity.expires_on)}</p>}
        <div className="relationship-opportunity-actions"><button type="button" className="btn btn--ghost btn--sm" onClick={() => openRoute(opportunity.route)}>Abrir origem</button><button type="button" className="btn btn--ghost btn--sm" disabled={!person.phone} onClick={() => onWhatsApp(opportunity)}>Conversar por este motivo</button>{opportunity.type === 'reschedule' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => void onDismiss(opportunity)}>Dispensar</button>}</div>
      </section>)}
    </div>
  </aside>;
}

function ContactComposer({ person, opportunity, clinicName, body, onBody, onClose, onRecord }: { person: RelationshipPerson; opportunity: RelationshipOpportunity; clinicName: string; body: string; onBody: (value: string) => void; onClose: () => void; onRecord: (recipient: string, body: string) => Promise<void> }) {
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const recipient = whatsappRecipientDigits(person.phone);
  const openWhatsApp = () => {
    const url = buildSafeWhatsAppUrl(person.phone, body);
    if (!url) { toast.error('Telefone inválido para WhatsApp.'); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  const copy = async () => { try { await copyCommunicationText(body); toast.success('Mensagem copiada. Nenhum contato foi registrado.'); } catch { toast.error('Não foi possível copiar.'); } };
  const record = async () => {
    if (!recipient) { toast.error('Telefone inválido.'); return; }
    setRecording(true);
    try { await onRecord(recipient, body); toast.success('Contato registrado.'); onClose(); }
    catch (err) { console.error('[relationship] contact record failed', err); toast.error('Não foi possível registrar o contato.'); }
    finally { setRecording(false); }
  };
  return <div className="relationship-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="relationship-modal" role="dialog" aria-modal="true" aria-label="Mensagem de relacionamento">
      <div className="relationship-modal-head"><div><span className="page-sub">{RELATIONSHIP_TYPE_LABEL[opportunity.type]}</span><h3>{person.display_name}</h3></div><button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div>
      <p className="relationship-contact-note">Abrir o WhatsApp ou copiar a mensagem <strong>não</strong> registra contato. O Hub só considera contato quando você confirma abaixo que enviou.</p>
      <textarea className="relationship-message" value={body} onChange={event => onBody(event.target.value)} rows={7} maxLength={12000} aria-label="Mensagem" />
      <div className="relationship-modal-actions"><button type="button" className="btn btn--secondary btn--sm" onClick={() => void copy()}>Copiar</button><button type="button" className="btn btn--primary btn--sm" onClick={openWhatsApp} disabled={!recipient}>Abrir WhatsApp</button><button type="button" className="btn btn--secondary btn--sm" onClick={() => void record()} disabled={!recipient || !body.trim() || recording}>{recording ? 'Registrando...' : 'Registrar que enviei'}</button></div>
      {clinicName && <div className="page-sub">Profissional: {clinicName}</div>}
    </section>
  </div>;
}

function ReasonPicker({ person, onPick, onClose }: { person: RelationshipPerson; onPick: (opportunity: RelationshipOpportunity) => void; onClose: () => void }) {
  return <div className="relationship-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="relationship-modal relationship-modal--small" role="dialog" aria-modal="true" aria-label="Escolher motivo"><div className="relationship-modal-head"><div><span className="page-sub">Por qual motivo?</span><h3>{person.display_name}</h3></div><button className="icon-btn" type="button" onClick={onClose}><X size={18} /></button></div><div className="relationship-reason-list">{person.opportunities.map(item => <button type="button" key={item.key} onClick={() => onPick(item)}><OpportunityBadge opportunity={item} /><span><strong>{item.label}</strong><small>Usar este contexto para a mensagem</small></span><ChevronRight size={17} /></button>)}</div></section></div>;
}

function SnoozeDialog({ person, onClose, onSave }: { person: RelationshipPerson; onClose: () => void; onSave: (date: string) => Promise<void> }) {
  const { toast } = useToast();
  const [date, setDate] = useState(addDaysIso(1));
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await onSave(date); toast.success(`Lembrado para ${relationshipDate(date)}.`); onClose(); } catch { toast.error('Não foi possível salvar o lembrete.'); } finally { setSaving(false); } };
  return <div className="relationship-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="relationship-modal relationship-modal--small" role="dialog" aria-modal="true" aria-label="Lembrar depois"><div className="relationship-modal-head"><div><span className="page-sub">Lembrar depois</span><h3>{person.display_name}</h3></div><button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button></div><div className="relationship-snooze-presets"><button className="btn btn--ghost btn--sm" onClick={() => setDate(addDaysIso(1))}>Amanhã</button><button className="btn btn--ghost btn--sm" onClick={() => setDate(addDaysIso(7))}>7 dias</button><button className="btn btn--ghost btn--sm" onClick={() => setDate(addDaysIso(30))}>30 dias</button></div><label className="relationship-field"><span>Reaparecer em</span><input type="date" min={localToday()} value={date} onChange={event => setDate(event.target.value)} /></label><button type="button" className="btn btn--primary btn--sm" disabled={!date || saving} onClick={() => void save()}>{saving ? 'Salvando...' : 'Lembrar nesta data'}</button></section></div>;
}

export function RelationshipPage() {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const initialCategory = params.get('category') as RelationshipOpportunityType | null;
  const [category, setCategory] = useState<RelationshipOpportunityType | null>(FILTERS.some(item => item.key === initialCategory) ? initialCategory : null);
  const [searchDraft, setSearchDraft] = useState(params.get('q') ?? '');
  const [search, setSearch] = useState((params.get('q') ?? '').trim().slice(0, 80));
  const [includeSnoozed, setIncludeSnoozed] = useState(params.get('snoozed') === '1');
  const [page, setPage] = useState(() => Math.max(0, Number(params.get('page') ?? 0) || 0));
  const hub = useRelationshipCenter({ category, search, includeSnoozed, page });
  const [selected, setSelected] = useState<RelationshipPerson | null>(null);
  const [reasonPerson, setReasonPerson] = useState<RelationshipPerson | null>(null);
  const [compose, setCompose] = useState<{ person: RelationshipPerson; opportunity: RelationshipOpportunity } | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [snoozePerson, setSnoozePerson] = useState<RelationshipPerson | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftPrefs, setDraftPrefs] = useState<RelationshipPreferences>(hub.preferences);
  const [proposalDays, setProposalDays] = useState(hub.communicationPreferences.proposal_followup_days);
  const [packageDays, setPackageDays] = useState(hub.communicationPreferences.package_expiry_days);

  useEffect(() => { const timer = window.setTimeout(() => { setSearch(searchDraft.trim().slice(0, 80)); setPage(0); }, 250); return () => window.clearTimeout(timer); }, [searchDraft]);
  useEffect(() => { setDraftPrefs(hub.preferences); setProposalDays(hub.communicationPreferences.proposal_followup_days); setPackageDays(hub.communicationPreferences.package_expiry_days); }, [hub.communicationPreferences, hub.preferences]);
  useEffect(() => {
    const personType = params.get('person_type'); const personId = params.get('person_id');
    if (!personId || (personType !== 'patient' && personType !== 'contact')) return;
    const match = hub.items.find(item => item.person_type === personType && item.person_id === personId);
    if (match) setSelected(match);
  }, [hub.items, params]);
  useEffect(() => {
    if (!selected) return;
    const fresh = hub.items.find(item => item.person_type === selected.person_type && item.person_id === selected.person_id);
    if (fresh && fresh !== selected) setSelected(fresh);
    else if (!fresh && !hub.loading) setSelected(null);
  }, [hub.items, hub.loading, selected]);

  const returnTo = useMemo(() => {
    const next = new URLSearchParams();
    if (category) next.set('category', category);
    if (search) next.set('q', search);
    if (includeSnoozed) next.set('snoozed', '1');
    if (page > 0) next.set('page', String(page));
    if (selected) { next.set('person_type', selected.person_type); next.set('person_id', selected.person_id); }
    const query = next.toString();
    return `/relacionamento${query ? `?${query}` : ''}`;
  }, [category, includeSnoozed, page, search, selected]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (category) next.set('category', category);
    if (search) next.set('q', search);
    if (includeSnoozed) next.set('snoozed', '1');
    if (page > 0) next.set('page', String(page));
    const personType = selected?.person_type ?? params.get('person_type');
    const personId = selected?.person_id ?? params.get('person_id');
    if (personType && personId) { next.set('person_type', personType); next.set('person_id', personId); }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [category, includeSnoozed, page, params, search, selected?.person_id, selected?.person_type, setParams]);

  const countFor = (key: RelationshipOpportunityType | null) => key === null ? hub.summary.total : hub.summary[key];
  const beginMessage = (person: RelationshipPerson, opportunity?: RelationshipOpportunity) => {
    if (!person.phone) { toast.error('Sem telefone cadastrado.'); return; }
    if (!opportunity && person.opportunities.length > 1) { setReasonPerson(person); return; }
    const target = opportunity ?? person.opportunities[0];
    if (!target) return;
    const override = hub.templateMap.get(target.template_key);
    const hasTypedCreditUnits = target.type === 'credit' && (target.remaining ?? []).some(item => !item.unit_label.toLowerCase().includes('crédito'));
    const template = override?.enabled
      ? override.body
      : hasTypedCreditUnits
        ? 'Oi, {first_name}! Tudo bem? Você ainda tem disponível no seu plano: {remaining_credits}. A validade é até {valid_until}. Se quiser, podemos organizar seu próximo horário.'
        : DEFAULT_COMMUNICATION_TEMPLATES[target.template_key];
    const values: Partial<Record<CommunicationPlaceholder, string>> = {
      first_name: firstName(person.display_name), name: person.display_name, clinic_name: hub.clinicName,
      proposal_title: String(target.context?.proposal_title ?? ''), valid_until: formatCommunicationDate(target.expires_on ?? (target.context?.valid_until as string | undefined)), package_title: String(target.context?.package_title ?? ''), remaining_credits: relationshipCreditSummary(target.remaining), aftercare_instructions: '', date: '', time: '',
    };
    setMessageBody(renderCommunicationTemplate(template, values));
    setCompose({ person, opportunity: target }); setReasonPerson(null);
  };

  const saveSettings = async () => {
    try { await hub.savePreferences(draftPrefs, { proposal_followup_days: proposalDays, package_expiry_days: packageDays }); toast.success('Preferências salvas.'); setSettingsOpen(false); }
    catch (err) { console.error('[relationship] preferences failed', err); toast.error('Não foi possível salvar as preferências.'); }
  };

  return <div className="relationship-page">
    <header className="relationship-header"><div><span className="page-sub">Relacionamento</span><h1>Pessoas para olhar</h1><p>O Hub encontra os motivos. Você decide se vale agir.</p></div><button type="button" className="btn btn--secondary btn--sm" onClick={() => setSettingsOpen(value => !value)}><Settings size={16} /> Configurações</button></header>
    <section className="relationship-summary" aria-label="Resumo de relacionamento">{FILTERS.map(filter => <button type="button" key={filter.key ?? 'all'} className={category === filter.key ? 'relationship-summary-card relationship-summary-card--active' : 'relationship-summary-card'} onClick={() => { setCategory(filter.key); setPage(0); }}><strong>{countFor(filter.key)}</strong><span>{filter.label}</span></button>)}</section>
    {settingsOpen && <section className="relationship-settings card"><div className="relationship-settings-head"><div><strong>Regras de relacionamento</strong><p className="page-sub">Poucas janelas, por profissional. Proposta e crédito reutilizam a Comunicação 3.4.</p></div><button className="icon-btn" type="button" onClick={() => setSettingsOpen(false)}><X size={17} /></button></div><div className="relationship-toggle-grid"><label><input type="checkbox" checked={draftPrefs.returns_enabled} onChange={event => setDraftPrefs(value => ({ ...value, returns_enabled: event.target.checked }))} /> Retornos</label><label><input type="checkbox" checked={draftPrefs.proposals_enabled} onChange={event => setDraftPrefs(value => ({ ...value, proposals_enabled: event.target.checked }))} /> Propostas</label><label><input type="checkbox" checked={draftPrefs.credits_enabled} onChange={event => setDraftPrefs(value => ({ ...value, credits_enabled: event.target.checked }))} /> Créditos</label><label><input type="checkbox" checked={draftPrefs.reactivation_enabled} onChange={event => setDraftPrefs(value => ({ ...value, reactivation_enabled: event.target.checked }))} /> Reativação</label></div><div className="relationship-settings-grid"><label className="relationship-field"><span>Reativação após</span><div><input type="number" min={30} max={1460} value={draftPrefs.reactivation_after_days} onChange={event => setDraftPrefs(value => ({ ...value, reactivation_after_days: Number(event.target.value) }))} /><small>dias sem atendimento</small></div></label><label className="relationship-field"><span>Proposta após</span><div><input type="number" min={0} max={30} value={proposalDays} onChange={event => setProposalDays(Number(event.target.value))} /><small>dias sem contato</small></div></label><label className="relationship-field"><span>Crédito quando faltar</span><div><input type="number" min={1} max={90} value={packageDays} onChange={event => setPackageDays(Number(event.target.value))} /><small>dias para vencer</small></div></label><label className="relationship-field"><span>Contato recente</span><div><input type="number" min={0} max={90} value={draftPrefs.recent_contact_cooldown_days} onChange={event => setDraftPrefs(value => ({ ...value, recent_contact_cooldown_days: Number(event.target.value) }))} /><small>dias de pausa</small></div></label></div><button type="button" className="btn btn--primary btn--sm" onClick={() => void saveSettings()}>Salvar regras</button></section>}
    <div className="relationship-toolbar"><label className="relationship-search"><Search size={16} /><input value={searchDraft} onChange={event => setSearchDraft(event.target.value)} placeholder="Buscar por nome ou telefone" maxLength={80} /></label><label className="relationship-snoozed-toggle"><input type="checkbox" checked={includeSnoozed} onChange={event => { setIncludeSnoozed(event.target.checked); setPage(0); }} /> Mostrar lembrados depois {hub.summary.snoozed > 0 && `(${hub.summary.snoozed})`}</label></div>
    {hub.error ? <div className="relationship-error"><strong>Não foi possível carregar Relacionamento.</strong><p>{hub.error}</p><button className="btn btn--secondary btn--sm" onClick={() => void hub.refresh()}>Tentar novamente</button></div> : hub.loading ? <div className="relationship-loading"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div> : hub.items.length === 0 ? <div className="relationship-empty"><Clock3 size={28} /><strong>Você está em dia com seus relacionamentos.</strong><p>Quando houver um motivo factual para olhar alguém, ele aparece aqui.</p></div> : <div className="relationship-workspace"><div className="relationship-list">{hub.items.map(person => <PersonCard key={`${person.person_type}:${person.person_id}`} person={person} active={selected?.person_id === person.person_id && selected.person_type === person.person_type} onOpen={() => setSelected(person)} onWhatsApp={() => beginMessage(person)} onSnooze={() => setSnoozePerson(person)} />)}<div className="relationship-pagination"><button className="btn btn--ghost btn--sm" type="button" disabled={page===0} onClick={() => setPage(value => Math.max(0,value-1))}><ChevronLeft size={15}/> Anterior</button><span className="page-sub">Página {page+1}</span><button className="btn btn--ghost btn--sm" type="button" disabled={hub.items.length < hub.pageSize} onClick={() => setPage(value => value+1)}>Próxima <ChevronRight size={15}/></button></div></div><PersonDetail person={selected} returnTo={returnTo} onWhatsApp={opportunity => selected && beginMessage(selected,opportunity)} onSnooze={() => selected && setSnoozePerson(selected)} onDismiss={async opportunity => { try { await hub.dismissOpportunity(opportunity); toast.success('Oportunidade dispensada.'); } catch { toast.error('Não foi possível dispensar.'); } }} /></div>}
    {reasonPerson && <ReasonPicker person={reasonPerson} onPick={opportunity => beginMessage(reasonPerson,opportunity)} onClose={() => setReasonPerson(null)} />}
    {compose && <ContactComposer person={compose.person} opportunity={compose.opportunity} clinicName={hub.clinicName} body={messageBody} onBody={setMessageBody} onClose={() => setCompose(null)} onRecord={(recipient,body) => hub.recordManualContact(compose.person,compose.opportunity,recipient,body)} />}
    {snoozePerson && <SnoozeDialog person={snoozePerson} onClose={() => setSnoozePerson(null)} onSave={async date => { const until = new Date(`${date}T09:00:00-03:00`); await hub.snoozePerson(snoozePerson,until); }} />}
  </div>;
}