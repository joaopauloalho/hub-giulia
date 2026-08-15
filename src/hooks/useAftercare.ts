import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AftercareOrientationStatus } from '../lib/aftercare';
export { aftercareDate, emptyServiceAftercareProtocol, normalizeServiceAftercareProtocol, orientationStatusLabel, validateAftercareSteps } from '../lib/aftercare';
export type { AftercareOrientationStatus, ServiceAftercareProtocol, ServiceAftercareStep } from '../lib/aftercare';

export type FollowupTaskStatus = 'pending' | 'completed' | 'cancelled';

export interface FollowupTask {
  id: string;
  task_type?: 'checkin';
  due_on: string;
  original_due_on?: string | null;
  label: string | null;
  status: FollowupTaskStatus;
  completed_at: string | null;
  note: string | null;
  cancelled_at: string | null;
  cancel_reason?: string | null;
  requires_professional_review: boolean;
  rescheduled_at?: string | null;
}

export interface FollowupReturn {
  id: string;
  service_name: string;
  return_type: string;
  window_start: string;
  window_end: string;
  appointment_id: string | null;
  appointment_status: string | null;
  appointment_scheduled_at: string | null;
  completed_at: string | null;
  dismissed_at: string | null;
}

export interface ProcedureFollowupSummary {
  id: string;
  procedure_id: string;
  patient_id: string | null;
  patient_name: string;
  performed_on: string;
  status: 'active' | 'cancelled';
  protocol_snapshot: unknown[];
  instructions_snapshot: string | null;
  instructions_snapshot_hash: string | null;
  photo_followup: boolean;
  orientation_status: AftercareOrientationStatus;
  manual_delivery: { at: string; method: string; note?: string | null } | null;
  tasks: FollowupTask[];
  next_task: { id: string; due_on: string; label: string | null; requires_professional_review: boolean } | null;
  returns: FollowupReturn[];
}

export interface PatientFollowupPlan {
  plan_id: string;
  procedure_id: string;
  performed_on: string;
  status: 'active' | 'cancelled';
  instructions_snapshot: string | null;
  orientation_status: AftercareOrientationStatus;
  photo_followup: boolean;
  tasks: FollowupTask[];
  returns: FollowupReturn[];
  created_at: string;
}

export function useProcedureFollowupSummary(procedureId: string | null | undefined) {
  const [summary, setSummary] = useState<ProcedureFollowupSummary | null>(null);
  const [loading, setLoading] = useState(Boolean(procedureId));
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!procedureId) { setSummary(null); setLoading(false); setError(null); return; }
    setLoading(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_procedure_followup_summary_v1', { p_procedure_id: procedureId });
    if (rpcError) { setSummary(null); setError(rpcError.message); }
    else setSummary((data as ProcedureFollowupSummary | null) ?? null);
    setLoading(false);
  }, [procedureId]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { summary, loading, error, refresh };
}

export function usePatientFollowupPlans(patientId: string, limit = 10) {
  const [plans, setPlans] = useState<PatientFollowupPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('list_patient_followup_plans_v1', { p_patient_id: patientId, p_limit: limit });
    if (rpcError) { setPlans([]); setError(rpcError.message); }
    else setPlans((data ?? []) as PatientFollowupPlan[]);
    setLoading(false);
  }, [limit, patientId]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { plans, loading, error, refresh };
}
