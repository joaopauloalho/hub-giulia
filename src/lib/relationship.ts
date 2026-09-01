import type { CommunicationTemplateKey } from './communications';

export type RelationshipPersonType = 'patient' | 'contact';
export type RelationshipOpportunityType = 'return' | 'proposal' | 'credit' | 'reactivation' | 'reschedule' | 'birthday';
export type RelationshipCreditBalance = { package_item_id: string; service_name: string; balance: number | string; unit_label: string };
export type RelationshipOpportunity = {
  key: string; type: RelationshipOpportunityType; priority_class: string;
  source_type: 'procedure_return' | 'proposal_version' | 'package' | 'relationship_patient' | 'appointment';
  source_id: string; status: string; label: string; due_date: string | null; age_days: number | null; amount: number | string | null;
  remaining: RelationshipCreditBalance[] | null; expires_on: string | null; route: string; communication_item_key: string; template_key: CommunicationTemplateKey; context: Record<string, unknown>;
};
export type RelationshipPerson = { person_type: RelationshipPersonType; person_id: string; patient_id: string | null; contact_id: string | null; display_name: string; phone: string | null; last_visit_at: string | null; next_appointment_at: string | null; last_contact_at: string | null; opportunity_count: number; highest_priority_type: RelationshipOpportunityType; opportunities: RelationshipOpportunity[]; snoozed_until: string | null; target_route: string };
export type RelationshipCounts = { total: number; return: number; proposal: number; credit: number; reactivation: number; reschedule: number; birthday: number; birthday_today: number; snoozed: number };
export type RelationshipPreferences = { returns_enabled: boolean; proposals_enabled: boolean; credits_enabled: boolean; reactivation_enabled: boolean; reactivation_after_days: number; recent_contact_cooldown_days: number };
export const DEFAULT_RELATIONSHIP_PREFERENCES: RelationshipPreferences = { returns_enabled:true, proposals_enabled:true, credits_enabled:true, reactivation_enabled:true, reactivation_after_days:180, recent_contact_cooldown_days:7 };
export const EMPTY_RELATIONSHIP_COUNTS: RelationshipCounts = { total:0, return:0, proposal:0, credit:0, reactivation:0, reschedule:0, birthday:0, birthday_today:0, snoozed:0 };
export const RELATIONSHIP_TYPE_LABEL: Record<RelationshipOpportunityType,string> = { return:'Retorno', proposal:'Proposta', credit:'Crédito', reactivation:'Reativação', reschedule:'Reagendar', birthday:'Aniversário' };
const PRIORITY_ORDER: Record<string,number> = { return_overdue:60, birthday_today:55, return_due:50, appointment_no_show_recovery:45, appointment_cancel_recovery:44, credit_expiry:40, return_upcoming:35, proposal_followup:30, birthday_upcoming:25, reactivation:10 };
export function relationshipPersonStateKey(personType:RelationshipPersonType,personId:string):string{return `relationship:${personType}:${personId}`;}
export function relationshipCreditSummary(items:RelationshipCreditBalance[]|null|undefined):string{if(!items?.length)return'';return items.map(item=>{const value=Number(item.balance);const amount=Number.isFinite(value)?value.toLocaleString('pt-BR',{maximumFractionDigits:3}):String(item.balance);return `${amount} ${item.unit_label}`.trim();}).join(' + ');}
export function sortRelationshipOpportunities(items:RelationshipOpportunity[]):RelationshipOpportunity[]{return[...items].sort((a,b)=>(PRIORITY_ORDER[b.priority_class]??0)-(PRIORITY_ORDER[a.priority_class]??0)||a.key.localeCompare(b.key));}
export function relationshipDate(value:string|null|undefined):string{if(!value)return'Nenhum';const date=/^\d{4}-\d{2}-\d{2}$/.test(value)?new Date(`${value}T12:00:00-03:00`):new Date(value);return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(date);}
export function relationshipDateTime(value:string|null|undefined):string{if(!value)return'Nenhum';return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
export function normalizeRelationshipPerson(value:RelationshipPerson):RelationshipPerson{return{...value,opportunity_count:Number(value.opportunity_count??value.opportunities?.length??0),opportunities:sortRelationshipOpportunities(value.opportunities??[])};}
