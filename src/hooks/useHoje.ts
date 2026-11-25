import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { POSTGREST_SELECT } from '../lib/postgrestRelationshipHints';
import { birthdayTiming } from '../lib/birthdays';
import {
  buildCallRows,
  buildChargeRows,
  buildLaunchRows,
  type CallBirthday,
  type CallFollowup,
  type CallReturn,
  type ChargeItem,
  type HojeRow,
  type LaunchVisit,
} from '../lib/hoje';
import { clinicTodayIso } from '../lib/returnStatus';
import { DEFAULT_COMMUNICATION_TEMPLATES } from '../lib/communications';
import type { ProcedurePayment, PixInstallment } from '../types';

type Section<T> = { rows: T[]; error: string | null };

const empty = <T,>(): Section<T> => ({ rows: [], error: null });

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function useHoje() {
  const [today, setToday] = useState(() => clinicTodayIso());
  const [loading, setLoading] = useState(true);
  const [launch, setLaunch] = useState<Section<HojeRow>>(empty);
  const [call, setCall] = useState<Section<HojeRow>>(empty);
  const [charge, setCharge] = useState<Section<HojeRow>>(empty);

  const refresh = useCallback(async () => {
    setLoading(true);
    const now = new Date();
    const todayIso = clinicTodayIso(now);
    setToday(todayIso);
    const since = `${addDays(todayIso, -14)}T00:00:00-03:00`;

    const [visitResult, returnResult, followResult, peopleResult, templateResult, procedurePayResult, pixResult, packagePayResult] = await Promise.all([
      loadVisits(since, now),
      supabase.rpc('list_procedure_returns_v2'),
      loadFollowups(todayIso),
      supabase.from('patients').select('id,name,phone,birth_date').is('archived_at', null),
      supabase.from('communication_templates').select('template_key,body,enabled').in('template_key', ['birthday_greeting', 'crm_followup']),
      supabase.from('procedure_payments').select(POSTGREST_SELECT.financeScheduledPayments).is('paid_at', null),
      supabase.from('pix_installments').select(POSTGREST_SELECT.financePixPending).is('paid_at', null),
      loadUnpaidPackages(),
    ]);

    if (visitResult.error) setLaunch({ rows: [], error: 'Não foi possível ver as visitas sem atendimento.' });
    else setLaunch({ rows: buildLaunchRows(visitResult.visits, todayIso, now), error: null });

    const templates = new Map<string, string>();
    for (const row of templateResult.data ?? []) {
      if (row.enabled !== false && row.body) templates.set(row.template_key, row.body);
    }
    const people = new Map((peopleResult.data ?? []).map(person => [person.id, person]));
    const callError = returnResult.error || followResult.error || peopleResult.error
      ? 'Não foi possível montar quem chamar.'
      : null;
    const returns: CallReturn[] = ((returnResult.data ?? []) as Array<Record<string, string | null>>).flatMap(row => {
      if (row.completed_at || row.dismissed_at) return [];
      if (row.appointment_id && !['cancelado', 'nao_compareceu'].includes(row.appointment_status ?? '')) return [];
      if (!row.window_start || row.window_start > todayIso) return [];
      return [{
        id: row.id ?? '',
        patientId: row.patient_id,
        name: row.patient_name || 'Paciente',
        phone: row.patient_phone,
        serviceName: row.service_name || 'retorno',
        returnType: row.return_type || 'clinical_return',
        windowEnd: row.window_end || todayIso,
        overdue: (row.window_end || todayIso) < todayIso,
      }];
    });
    const birthdays: CallBirthday[] = (peopleResult.data ?? []).flatMap(person => {
      if (birthdayTiming(person.birth_date, todayIso) !== 'today') return [];
      return [{ patientId: person.id, name: person.name, phone: person.phone }];
    });
    setCall({
      rows: callError ? [] : buildCallRows({
        returns,
        followups: followResult.rows,
        birthdays,
        todayIso,
        followupTemplate: templates.get('crm_followup') || DEFAULT_COMMUNICATION_TEMPLATES.crm_followup,
        birthdayTemplate: templates.get('birthday_greeting') || DEFAULT_COMMUNICATION_TEMPLATES.birthday_greeting,
      }),
      error: callError,
    });

    if (procedurePayResult.error || pixResult.error) {
      setCharge({ rows: [], error: 'Não foi possível ver os pagamentos pendentes.' });
    } else {
      const totals = new Map<string, ChargeItem>();
      const add = (patientId: string | null | undefined, name: string | null | undefined, amount: number | null | undefined) => {
        if (!patientId || !amount || amount <= 0) return;
        const current = totals.get(patientId) ?? { patientId, name: name || people.get(patientId)?.name || 'Paciente', amount: 0, count: 0 };
        current.amount += Number(amount);
        current.count += 1;
        totals.set(patientId, current);
      };
      for (const payment of (procedurePayResult.data ?? []) as ProcedurePayment[]) {
        add(payment.procedure?.patient_id, payment.procedure?.patient?.name, Number(payment.amount));
      }
      for (const installment of (pixResult.data ?? []) as PixInstallment[]) {
        add(installment.procedure?.patient_id, installment.procedure?.patient?.name, Number(installment.amount));
      }
      if (!packagePayResult.error) for (const payment of packagePayResult.rows) add(payment.patientId, payment.name, payment.amount);
      setCharge({ rows: buildChargeRows([...totals.values()]), error: null });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { today, loading, launch, call, charge, refresh };
}

async function loadVisits(since: string, now: Date): Promise<{ visits: LaunchVisit[]; error: boolean }> {
  const [icloud, appointments] = await Promise.all([
    supabase.from('icloud_calendar_events').select('id,title,starts_at,linked_patient_id,linked_appointment_id,is_deleted').eq('is_deleted', false).is('linked_appointment_id', null).gte('starts_at', since).lte('starts_at', now.toISOString()),
    supabase.from('appointments').select('id,scheduled_at,patient_id,status,patient:patients!appointments_patient_owner_fkey(id,name)').gte('scheduled_at', since).lte('scheduled_at', now.toISOString()).in('status', ['pendente', 'confirmado', 'realizado']),
  ]);
  if (icloud.error || appointments.error) return { visits: [], error: true };
  const appointmentIds = (appointments.data ?? []).map(row => row.id);
  const procedures = appointmentIds.length
    ? await supabase.from('procedures').select('appointment_id').in('appointment_id', appointmentIds)
    : { data: [], error: null };
  if (procedures.error) return { visits: [], error: true };
  const logged = new Set((procedures.data ?? []).map(row => row.appointment_id).filter(Boolean));
  const patientIds = [...new Set((icloud.data ?? []).map(row => row.linked_patient_id).filter((id): id is string => Boolean(id)))];
  const patients = patientIds.length
    ? await supabase.from('patients').select('id,name').in('id', patientIds)
    : { data: [], error: null };
  if (patients.error) return { visits: [], error: true };
  const names = new Map((patients.data ?? []).map(row => [row.id, row.name]));
  const visits: LaunchVisit[] = [
    ...(icloud.data ?? []).map(row => ({
      id: `icloud:${row.id}`,
      name: (row.linked_patient_id && names.get(row.linked_patient_id)) || row.title || 'Compromisso',
      at: row.starts_at,
      patientId: row.linked_patient_id,
    })),
    ...(appointments.data ?? []).flatMap(row => {
      if (logged.has(row.id)) return [];
      const patient = row.patient as { name?: string } | { name?: string }[] | null;
      const name = Array.isArray(patient) ? patient[0]?.name : patient?.name;
      return [{ id: `appointment:${row.id}`, name: name || 'Paciente', at: row.scheduled_at, patientId: row.patient_id }];
    }),
  ];
  return { visits, error: false };
}

async function loadFollowups(todayIso: string): Promise<{ rows: CallFollowup[]; error: boolean }> {
  const followups = await supabase.from('crm_followups').select('id,due_on,deal_id').eq('status', 'open').lte('due_on', todayIso);
  if (followups.error) return { rows: [], error: true };
  const dealIds = [...new Set((followups.data ?? []).map(row => row.deal_id))];
  if (!dealIds.length) return { rows: [], error: false };
  const deals = await supabase.from('deals').select('id,contact_id').in('id', dealIds);
  if (deals.error) return { rows: [], error: true };
  const contactIds = [...new Set((deals.data ?? []).map(row => row.contact_id).filter((id): id is string => Boolean(id)))];
  const contacts = contactIds.length
    ? await supabase.from('contacts').select('id,name,phone,patient_id').in('id', contactIds)
    : { data: [], error: null };
  if (contacts.error) return { rows: [], error: true };
  const contactById = new Map((contacts.data ?? []).map(row => [row.id, row]));
  const dealContact = new Map((deals.data ?? []).map(row => [row.id, row.contact_id]));
  return {
    rows: (followups.data ?? []).map(row => {
      const contact = contactById.get(dealContact.get(row.deal_id) ?? '');
      return {
        id: row.id,
        name: contact?.name || 'Contato',
        phone: contact?.phone ?? null,
        patientId: contact?.patient_id ?? null,
        dueOn: row.due_on,
      };
    }),
    error: false,
  };
}

async function loadUnpaidPackages(): Promise<{ rows: Array<{ patientId: string; name: string; amount: number }>; error: boolean }> {
  const payments = await supabase.from('package_payments').select('id,amount,package_id').is('paid_at', null);
  if (payments.error) return { rows: [], error: true };
  const packageIds = [...new Set((payments.data ?? []).map(row => row.package_id))];
  if (!packageIds.length) return { rows: [], error: false };
  const packages = await supabase.from('patient_packages').select('id,patient_id,patient:patients!patient_packages_patient_owner_fkey(name)').in('id', packageIds);
  if (packages.error) return { rows: [], error: true };
  const byId = new Map((packages.data ?? []).map(row => [row.id, row]));
  return {
    rows: (payments.data ?? []).flatMap(row => {
      const pack = byId.get(row.package_id);
      if (!pack?.patient_id) return [];
      const patient = pack.patient as { name?: string } | { name?: string }[] | null;
      const name = Array.isArray(patient) ? patient[0]?.name : patient?.name;
      return [{ patientId: pack.patient_id, name: name || 'Paciente', amount: Number(row.amount) }];
    }),
    error: false,
  };
}
