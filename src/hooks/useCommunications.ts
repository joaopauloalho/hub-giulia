import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '../lib/supabase';
import { DEFAULT_COMMUNICATION_PREFERENCES, type CommunicationAttentionItem, type CommunicationCounts, type CommunicationPreferences, type CommunicationTemplateKey } from '../lib/communications';

export type CommunicationTemplateOverride = { id: string; template_key: CommunicationTemplateKey; body: string; enabled: boolean };
export type PatientCommunication = { id: string; channel: string; context: string; status: string; sent_at: string; message_body_snapshot: string; item_key: string };

function normalizeCounts(value: unknown): CommunicationCounts {
  const data = (value ?? {}) as Partial<Record<keyof CommunicationCounts, unknown>>;
  return { total: Number(data.total ?? 0), confirmation: Number(data.confirmation ?? 0), crm: Number(data.crm ?? 0), return: Number(data.return ?? 0), proposal: Number(data.proposal ?? 0), package: Number(data.package ?? 0), overdue: Number(data.overdue ?? 0), today: Number(data.today ?? 0) };
}

export function useCommunicationCenter(options?: { category?: string | null; search?: string; includeSnoozed?: boolean }) {
  const { user } = useAuth();
  const [items, setItems] = useState<CommunicationAttentionItem[]>([]);
  const [counts, setCounts] = useState<CommunicationCounts>(() => normalizeCounts(null));
  const [templates, setTemplates] = useState<CommunicationTemplateOverride[]>([]);
  const [preferences, setPreferences] = useState<CommunicationPreferences>(DEFAULT_COMMUNICATION_PREFERENCES);
  const [clinicName, setClinicName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const category = options?.category ?? null;
  const search = options?.search?.trim() ?? '';
  const includeSnoozed = options?.includeSnoozed ?? false;

  const refresh = useCallback(async () => {
    if (!user) { setItems([]); setCounts(normalizeCounts(null)); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [attentionResult, countsResult, templatesResult, preferencesResult, profileResult] = await Promise.all([
        supabase.rpc('list_communication_attention_v1', { p_category: category || null, p_search: search || null, p_include_snoozed: includeSnoozed, p_limit: 100, p_offset: 0 }),
        supabase.rpc('get_communication_attention_counts_v1'),
        supabase.from('communication_templates').select('id,template_key,body,enabled').order('template_key'),
        supabase.from('communication_preferences').select('confirmation_lead_hours,proposal_followup_days,package_expiry_days').maybeSingle(),
        supabase.from('professional_profiles').select('display_name').maybeSingle(),
      ]);
      if (attentionResult.error) throw attentionResult.error;
      if (countsResult.error) throw countsResult.error;
      if (templatesResult.error) throw templatesResult.error;
      if (preferencesResult.error) throw preferencesResult.error;
      if (profileResult.error) throw profileResult.error;
      setItems((attentionResult.data ?? []) as CommunicationAttentionItem[]);
      setCounts(normalizeCounts(countsResult.data));
      setTemplates((templatesResult.data ?? []) as CommunicationTemplateOverride[]);
      setPreferences(preferencesResult.data ? { confirmation_lead_hours: Number(preferencesResult.data.confirmation_lead_hours), proposal_followup_days: Number(preferencesResult.data.proposal_followup_days), package_expiry_days: Number(preferencesResult.data.package_expiry_days) } : DEFAULT_COMMUNICATION_PREFERENCES);
      setClinicName(String(profileResult.data?.display_name ?? ''));
    } catch (err) {
      console.error('[communications] load failed', err);
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a Central de Comunicação.');
    } finally { setLoading(false); }
  }, [category, includeSnoozed, search, user]);

  useEffect(() => { void refresh(); }, [refresh]);
  const templateMap = useMemo(() => new Map(templates.map(item => [item.template_key, item])), [templates]);

  const saveTemplate = useCallback(async (templateKey: CommunicationTemplateKey, body: string) => {
    if (!user) throw new Error('Sessão necessária.');
    const { error: saveError } = await supabase.from('communication_templates').upsert({ user_id: user.id, template_key: templateKey, body, enabled: true }, { onConflict: 'user_id,template_key' });
    if (saveError) throw saveError; await refresh();
  }, [refresh, user]);

  const restoreTemplate = useCallback(async (templateKey: CommunicationTemplateKey) => {
    if (!user) throw new Error('Sessão necessária.');
    const { error: deleteError } = await supabase.from('communication_templates').delete().eq('user_id', user.id).eq('template_key', templateKey);
    if (deleteError) throw deleteError; await refresh();
  }, [refresh, user]);

  const savePreferences = useCallback(async (next: CommunicationPreferences) => {
    if (!user) throw new Error('Sessão necessária.');
    const { error: saveError } = await supabase.from('communication_preferences').upsert({ user_id: user.id, ...next }, { onConflict: 'user_id' });
    if (saveError) throw saveError; await refresh();
  }, [refresh, user]);

  const snooze = useCallback(async (itemKey: string, until: Date) => {
    if (!user) throw new Error('Sessão necessária.');
    const { error: snoozeError } = await supabase.from('communication_attention_state').upsert({ user_id: user.id, item_key: itemKey, snoozed_until: until.toISOString() }, { onConflict: 'user_id,item_key' });
    if (snoozeError) throw snoozeError; await refresh();
  }, [refresh, user]);

  const recordManual = useCallback(async (item: CommunicationAttentionItem, recipientPhone: string, body: string, idempotencyKey: string) => {
    const { data, error: recordError } = await supabase.rpc('record_manual_communication_v1', { p_source_type: item.source_type, p_source_id: item.source_id, p_item_key: item.item_key, p_context: item.template_key, p_recipient_phone: recipientPhone, p_message_body: body, p_template_key: item.template_key, p_idempotency_key: idempotencyKey });
    if (recordError) throw recordError;
    return (data as Array<{ message_id: string; sent_at: string; was_created: boolean }> | null)?.[0] ?? null;
  }, []);

  const confirmAppointment = useCallback(async (appointmentId: string) => {
    const { error: updateError } = await supabase.from('appointments').update({ status: 'confirmado' }).eq('id', appointmentId);
    if (updateError) throw updateError;
    void supabase.functions.invoke('google-calendar-upsert', { body: { appointment_id: appointmentId } }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  const completeCrmFollowup = useCallback(async (followupId: string) => {
    const { error: updateError } = await supabase.from('crm_followups').update({ status: 'completed' }).eq('id', followupId);
    if (updateError) throw updateError; await refresh();
  }, [refresh]);

  const createCrmFollowup = useCallback(async (dealId: string, dueOn: string) => {
    if (!user) throw new Error('Sessão necessária.');
    const { error: insertError } = await supabase.from('crm_followups').insert({ user_id: user.id, deal_id: dealId, due_on: dueOn, status: 'open' });
    if (insertError) throw insertError; await refresh();
  }, [refresh, user]);

  const markReturnContacted = useCallback(async (returnId: string) => {
    const { error: actionError } = await supabase.rpc('mark_procedure_return_contacted_v2', { p_return_id: returnId, p_method: 'whatsapp' });
    if (actionError) throw actionError; await refresh();
  }, [refresh]);

  return { items, counts, templates, templateMap, preferences, clinicName, loading, error, refresh, saveTemplate, restoreTemplate, savePreferences, snooze, recordManual, confirmAppointment, completeCrmFollowup, createCrmFollowup, markReturnContacted };
}

export function useCommunicationCounts() {
  const { user } = useAuth();
  const [counts, setCounts] = useState<CommunicationCounts>(() => normalizeCounts(null));
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true); const { data, error } = await supabase.rpc('get_communication_attention_counts_v1');
    if (!error) setCounts(normalizeCounts(data)); setLoading(false);
  }, [user]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { counts, loading, refresh };
}

export function usePatientCommunications(patientId: string, limit = 5) {
  const [items, setItems] = useState<PatientCommunication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    void supabase.rpc('list_patient_communications_v1', { p_patient_id: patientId, p_limit: limit, p_offset: 0 }).then(({ data, error: loadError }) => {
      if (!alive) return;
      if (loadError) { setItems([]); setError(loadError.message); } else setItems((data ?? []) as PatientCommunication[]);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [limit, patientId]);
  return { items, loading, error };
}
