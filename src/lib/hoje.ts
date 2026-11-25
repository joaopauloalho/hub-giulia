import { DEFAULT_COMMUNICATION_TEMPLATES, firstName, renderCommunicationTemplate } from './communications';
import { daysBetweenIso } from './returnStatus';
import { returnWhatsappMessage } from './returnContact';

export const HOJE_PREVIEW_LIMIT = 5;
export const HOJE_VISIT_LOOKBACK_DAYS = 14;

export type HojeAction = 'whatsapp' | 'register' | 'patient' | 'agenda';

export type HojeRow = {
  id: string;
  name: string;
  detail: string;
  action: HojeAction;
  actionLabel: string;
  phone: string | null;
  patientId: string | null;
  returnId: string | null;
  message: string | null;
  href: string | null;
};

export type LaunchVisit = {
  id: string;
  name: string;
  at: string;
  patientId: string | null;
};

export type CallReturn = {
  id: string;
  patientId: string | null;
  name: string;
  phone: string | null;
  serviceName: string;
  returnType: string;
  windowEnd: string;
  overdue: boolean;
};

export type CallFollowup = {
  id: string;
  name: string;
  phone: string | null;
  patientId: string | null;
  dueOn: string;
};

export type CallBirthday = {
  patientId: string;
  name: string;
  phone: string | null;
};

export type ChargeItem = {
  patientId: string;
  name: string;
  amount: number;
  count: number;
};

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export function previewRows<T>(rows: T[], limit = HOJE_PREVIEW_LIMIT, expanded = false): { rows: T[]; hidden: number } {
  if (expanded || rows.length <= limit) return { rows, hidden: 0 };
  return { rows: rows.slice(0, limit), hidden: rows.length - limit };
}

function clinicDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function clinicClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function buildLaunchRows(visits: LaunchVisit[], todayIso: string, now: Date): HojeRow[] {
  const nowMs = now.getTime();
  return visits
    .filter(visit => {
      const at = new Date(visit.at).getTime();
      if (!Number.isFinite(at) || at > nowMs) return false;
      const day = clinicDate(visit.at);
      return day !== '' && daysBetweenIso(day, todayIso) <= HOJE_VISIT_LOOKBACK_DAYS && daysBetweenIso(day, todayIso) >= 0;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(visit => ({
      id: visit.id,
      name: visit.name,
      detail: `${clinicClock(visit.at)} · sem atendimento`,
      action: visit.patientId ? 'register' as const : 'agenda' as const,
      actionLabel: visit.patientId ? 'Registrar' : 'Agenda',
      phone: null,
      patientId: visit.patientId,
      returnId: null,
      message: null,
      href: visit.patientId ? `/registrar?patient_id=${visit.patientId}` : '/agenda',
    }));
}

function greeting(template: string, fallback: string, name: string): string {
  const values = { first_name: firstName(name), name };
  try {
    return renderCommunicationTemplate(template, values);
  } catch {
    return renderCommunicationTemplate(fallback, values);
  }
}

export function buildCallRows(input: {
  returns: CallReturn[];
  followups: CallFollowup[];
  birthdays: CallBirthday[];
  todayIso: string;
  followupTemplate?: string;
  birthdayTemplate?: string;
}): HojeRow[] {
  const followupTemplate = input.followupTemplate || DEFAULT_COMMUNICATION_TEMPLATES.crm_followup;
  const birthdayTemplate = input.birthdayTemplate || DEFAULT_COMMUNICATION_TEMPLATES.birthday_greeting;
  const returns = input.returns
    .map(item => ({
      sort: item.overdue ? 0 : 1,
      row: {
        id: `return:${item.id}`,
        name: item.name,
        detail: item.overdue ? `Retorno atrasado · ${item.serviceName}` : `Retorno na janela · ${item.serviceName}`,
        action: 'whatsapp' as const,
        actionLabel: 'WhatsApp',
        phone: item.phone,
        patientId: item.patientId,
        returnId: item.id,
        message: returnWhatsappMessage({ patientName: item.name, serviceName: item.serviceName, returnType: item.returnType }),
        href: item.patientId ? `/pacientes/${item.patientId}` : null,
      },
    }));
  const followups = input.followups
    .filter(item => item.dueOn <= input.todayIso)
    .map(item => ({
      sort: 2,
      row: {
        id: `followup:${item.id}`,
        name: item.name,
        detail: item.dueOn < input.todayIso ? 'Follow-up atrasado' : 'Follow-up de hoje',
        action: 'whatsapp' as const,
        actionLabel: 'WhatsApp',
        phone: item.phone,
        patientId: item.patientId,
        returnId: null,
        message: greeting(followupTemplate, DEFAULT_COMMUNICATION_TEMPLATES.crm_followup, item.name),
        href: item.patientId ? `/pacientes/${item.patientId}` : '/crm',
      },
    }));
  const birthdays = input.birthdays.map(item => ({
    sort: 3,
    row: {
      id: `birthday:${item.patientId}`,
      name: item.name,
      detail: 'Aniversário hoje',
      action: 'whatsapp' as const,
      actionLabel: 'WhatsApp',
      phone: item.phone,
      patientId: item.patientId,
      returnId: null,
      message: greeting(birthdayTemplate, DEFAULT_COMMUNICATION_TEMPLATES.birthday_greeting, item.name),
      href: `/aniversarios?patient=${item.patientId}`,
    },
  }));
  return [...returns, ...followups, ...birthdays]
    .sort((a, b) => a.sort - b.sort || a.row.name.localeCompare(b.row.name, 'pt-BR'))
    .map(item => item.row);
}

export function buildChargeRows(items: ChargeItem[]): HojeRow[] {
  return [...items]
    .filter(item => item.amount > 0 && item.patientId)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'pt-BR'))
    .map(item => ({
      id: `charge:${item.patientId}`,
      name: item.name,
      detail: item.count > 1 ? `${item.count} cobranças · ${money(item.amount)}` : `${money(item.amount)} pendente`,
      action: 'patient' as const,
      actionLabel: 'Abrir',
      phone: null,
      patientId: item.patientId,
      returnId: null,
      message: null,
      href: `/pacientes/${item.patientId}?tab=finance`,
    }));
}
