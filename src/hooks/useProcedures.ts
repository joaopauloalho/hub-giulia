import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Procedure, PaymentMethod } from '../types';
import type { PackageCoverageSelection } from '../types/packages';
import type { ProcedureMaterialInput } from '../types/materials';
import { useAtomicAttendance } from './useAtomicAttendance';
import { POSTGREST_SELECT } from '../lib/postgrestRelationshipHints';
import {
  clearAttendanceInjectableDraft,
  clearAttendanceInjectablePoints,
  consumePendingAttendanceError,
  getAttendanceInjectableDraft,
  getAttendanceInjectablePoints,
  markAtomicAttendanceProcedure,
  setPendingAttendanceError,
} from '../lib/attendanceRuntime';
import { getAttendanceErrorMessage } from '../lib/attendanceErrors';

interface PaymentEntryInput {
  method: string;
  amount: number;
  card_brand: string | null;
  installments: number;
  fee_pct: number | null;
  fee_value: number | null;
  net_amount: number;
  absorve_taxa: boolean;
  scheduled_date: string | null;
  is_immediate: boolean;
}

interface CreateProcedureInput {
  patient_id: string;
  appointment_id?: string | null;
  performed_at?: string;
  services_ids: string[];
  total_value: number;
  total_cost: number;
  payment_method: PaymentMethod;
  card_fee_pct?: number | null;
  card_fee_value?: number | null;
  net_value: number;
  notes?: string | null;
  pix_installments_count?: number;
  payment_entries?: PaymentEntryInput[];
  coverage_entries?: PackageCoverageSelection[];
  material_entries?: ProcedureMaterialInput[];
  item_values?: Array<{ service_id: string; qty?: number; final_price: number }>;
}

export function useProcedures(patientId?: string) {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const performedAtRef = useRef<string | null>(null);
  const inFlightCreateRef = useRef<Promise<Procedure> | null>(null);
  const { createAtomic } = useAtomicAttendance();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if (patientId) {
        const { data, error: proceduresError } = await supabase
          .from('procedures')
          .select(POSTGREST_SELECT.patientProcedures)
          .eq('patient_id', patientId)
          .order('performed_at', { ascending: false });
        if (proceduresError) throw proceduresError;
        const rows = (data ?? []).map(row => ({
          ...row,
          items: row.procedure_items ?? [],
          payments: row.procedure_payments ?? [],
        }));
        setProcedures(rows as unknown as Procedure[]);
      } else {
        const { data, error: proceduresError } = await supabase
          .from('procedures')
          .select('*')
          .order('performed_at', { ascending: false });
        if (proceduresError) throw proceduresError;
        setProcedures((data ?? []) as Procedure[]);
      }
    } catch (err) {
      console.error('[useProcedures.refresh]', err);
      setProcedures([]);
      setError('Não foi possível carregar os atendimentos.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async (input: CreateProcedureInput): Promise<Procedure> => {
    if (inFlightCreateRef.current) return inFlightCreateRef.current;

    consumePendingAttendanceError();
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    const performedAt = input.performed_at ?? performedAtRef.current ?? new Date().toISOString();
    performedAtRef.current = performedAt;

    const operation = (async () => {
      try {
        const coverageEntries = input.coverage_entries ?? [];
        const materialEntries = input.material_entries ?? [];
        const paymentInput = input.payment_entries ?? [];
        if (input.total_value > 0.02 && paymentInput.length === 0) throw new Error('ATTENDANCE_PAYMENTS_REQUIRED');

        const { data: serviceRows, error: servicesError } = await supabase
          .from('services')
          .select('id, price')
          .in('id', input.services_ids);
        if (servicesError) throw servicesError;

        const priceByService = new Map((serviceRows ?? []).map(service => [service.id, Number(service.price)]));
        const explicitItems = new Map((input.item_values ?? []).map(item => [item.service_id, item]));
        const items = input.services_ids.map(serviceId => {
          const explicit = explicitItems.get(serviceId);
          const price = explicit?.final_price ?? priceByService.get(serviceId);
          const qty = explicit?.qty ?? 1;
          if (price === undefined || !Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) throw new Error('ATTENDANCE_SERVICE_FORBIDDEN');
          return { service_id: serviceId, qty, final_price: Number(price) };
        });

        const paymentEntries = paymentInput.map(entry => ({
          method: entry.method,
          base_amount: entry.absorve_taxa ? entry.amount : entry.net_amount,
          amount: entry.amount,
          card_brand: entry.card_brand,
          installments: entry.installments,
          fee_pct: entry.fee_pct,
          fee_value: entry.fee_value,
          net_amount: entry.net_amount,
          absorve_taxa: entry.absorve_taxa,
          scheduled_date: entry.scheduled_date,
        }));

        const injectableDraft = getAttendanceInjectableDraft();
        const injectablePoints = getAttendanceInjectablePoints(input.services_ids);
        const procedure = await createAtomic({
          idempotency_key: idempotencyKey,
          patient_id: input.patient_id,
          appointment_id: input.appointment_id ?? null,
          performed_at: performedAt,
          items,
          payment_entries: paymentEntries,
          coverages: coverageEntries,
          materials: materialEntries,
          injectable_maps: injectableDraft ? [] : (injectablePoints.length > 0 ? [{ points: injectablePoints }] : []),
          injectable_draft_id: injectableDraft?.mapId ?? null,
          injectable_draft_revision: injectableDraft?.revision ?? null,
          notes: input.notes ?? null,
        });

        if (injectableDraft || injectablePoints.length > 0) markAtomicAttendanceProcedure(procedure.id);
        clearAttendanceInjectableDraft();
        clearAttendanceInjectablePoints();
        idempotencyKeyRef.current = null;
        performedAtRef.current = null;
        await refresh();
        return procedure;
      } catch (err) {
        console.error('[attendance:create]', err);
        setPendingAttendanceError(getAttendanceErrorMessage(err));
        throw err;
      }
    })();

    inFlightCreateRef.current = operation;
    try {
      return await operation;
    } finally {
      if (inFlightCreateRef.current === operation) inFlightCreateRef.current = null;
    }
  };

  return { procedures, loading, error, create, refresh };
}
