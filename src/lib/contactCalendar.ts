import { supabase } from './supabase';
export type ContactCalendarEvent = {
  item_key: string; event_date: string; kind: 'birthday' | 'procedure'; patient_id: string;
  patient_name: string; phone: string | null; service_name: string | null; contacted_at: string | null;
};
export function clinicToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function shiftDate(iso: string, days: number) {
  const date = new Date(iso + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function weekMonday(iso: string) {
  return shiftDate(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7));
}
export function addMonthsClamped(iso: string, months: number) {
  const [year, month, day] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const max = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return first.toISOString().slice(0, 8) + String(Math.min(day, max)).padStart(2, '0');
}
export function suggestedContactMonths(name: string) { return /botox|toxina botul/i.test(name) ? 4 : 6; }
export async function listContactCalendar(start: string, end: string): Promise<ContactCalendarEvent[]> {
  const { data, error } = await supabase.rpc('list_contact_calendar_v1', { p_start: start, p_end: end });
  if (error) throw error; return (data ?? []) as ContactCalendarEvent[];
}
export async function saveContactReminders(patientId: string, procedureId: string, performedAt: string,
  choices: Array<{ service_id: string; service_name: string; months_after: number }>) {
  if (!choices.length) return;
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw authError ?? new Error('Sessão expirada.');
  const rows = choices.map(choice => ({
    user_id: user.id, patient_id: patientId, procedure_id: procedureId, service_id: choice.service_id,
    service_name: choice.service_name, performed_at: performedAt, months_after: choice.months_after,
    due_on: addMonthsClamped(performedAt.slice(0, 10), choice.months_after),
  }));
  const { error } = await supabase.from('contact_calendar_reminders').upsert(rows,
    { onConflict: 'user_id,procedure_id,service_id', ignoreDuplicates: true });
  if (error) throw error;
}
export async function setContactMarked(event: ContactCalendarEvent, checked: boolean): Promise<string | null> {
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw authError ?? new Error('Sessão expirada.');
  if (!checked) {
    const { error } = await supabase.from('contact_calendar_marks').delete()
      .eq('user_id', user.id).eq('item_key', event.item_key);
    if (error) throw error; return null;
  }
  const contactedAt = new Date().toISOString();
  const { error } = await supabase.from('contact_calendar_marks')
    .upsert({ user_id: user.id, patient_id: event.patient_id, item_key: event.item_key, contacted_at: contactedAt },
      { onConflict: 'user_id,item_key' });
  if (error) throw error; return contactedAt;
}
