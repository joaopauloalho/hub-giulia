import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Procedure, PaymentMethod } from '../types';
import { useAtomicAttendance } from './useAtomicAttendance';
import {
  clearAttendanceInjectablePoints,
  consumePendingAttendanceError,
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
}

export function useProcedures(patientId?: string) {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const inFlightCreateRef = useRef<Promise<Procedure> | null>(null);
  const { createAtomic } = useAtomicAttendance();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let q = supabase
        .from('procedures')
        .select('*')
        .order('performed_at', { ascending: false });
      if (patientId) q = q.eq('patient_id', patientId);
      const { data, error: proceduresError } = await q;
      if (proceduresError) throw proceduresError;
      setProcedures(data ?? []);
    } catch (err) {
      setProcedures([]);
      setError(err instanceof Error ? err.message : 'Erro ao carregar atendimentos.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (input: CreateProcedureInput): Promise<Procedure> => {
    if (inFlightCreateRef.current) return inFlightCreateRef.current;

    consumePendingAttendanceError();
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;

    const operation = (async () => {
      try {
        if (!input.payment_entries || input.payment_entries.length === 0) {
          throw new Error('ATTENDANCE_PAYMENTS_REQUIRED');
        }

        const { data: serviceRows, error: servicesError } = await supabase
          .from('services')
          .select('id, price')
          .in('id', input.services_ids);

        if (servicesError) throw servicesError;

        const priceByService = new Map(
          (serviceRows ?? []).map(service => [service.id, Number(service.price)]),
        );

        const items = input.services_ids.map(serviceId => {
          const price = priceByService.get(serviceId);
          if (price === undefined || !Number.isFinite(price)) {
            throw new Error('ATTENDANCE_SERVICE_FORBIDDEN');
          }
          return { service_id: serviceId, qty: 1, final_price: price };
        });

        const paymentEntries = input.payment_entries.map(entry => ({
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

        const injectablePoints = getAttendanceInjectablePoints(input.services_ids);
        const procedure = await createAtomic({
          idempotency_key: idempotencyKey,
          patient_id: input.patient_id,
          appointment_id: input.appointment_id ?? null,
          performed_at: input.performed_at ?? new Date().toISOString(),
          items,
          payment_entries: paymentEntries,
          injectable_maps: injectablePoints.length > 0 ? [{ points: injectablePoints }] : [],
          notes: input.notes ?? null,
        });

        if (injectablePoints.length > 0) {
          markAtomicAttendanceProcedure(procedure.id);
        }
        clearAttendanceInjectablePoints();
        idempotencyKeyRef.current = null;
        await refresh();
        return procedure;
      } catch (err) {
        console.error('[attendance:create_procedure_v2]', err);
        setPendingAttendanceError(getAttendanceErrorMessage(err));
        throw err;
      }
    })();

    inFlightCreateRef.current = operation;
    try {
      return await operation;
    } finally {
      if (inFlightCreateRef.current === operation) {
        inFlightCreateRef.current = null;
      }
    }
  };

  const remove = async (procedureId: string) => {
    const { error: rpcError } = await supabase.rpc('remove_procedure_cascade', {
      p_procedure_id: procedureId,
    });

    if (!rpcError) {
      await refresh();
      return;
    }

    if (rpcError.code !== 'PGRST202' && rpcError.code !== '42883') {
      throw rpcError;
    }

    const { data: proc, error: fetchError } = await supabase
      .from('procedures')
      .select('id, appointment_id')
      .eq('id', procedureId)
      .single();
    if (fetchError) throw fetchError;

    await supabase.from('patient_photos').update({ procedure_id: null }).eq('procedure_id', procedureId);
    await supabase.from('injectable_maps').update({ procedure_id: null }).eq('procedure_id', procedureId);

    const { error: paymentsError } = await supabase
      .from('procedure_payments')
      .delete()
      .eq('procedure_id', procedureId);
    if (paymentsError) throw paymentsError;

    const { error: pixError } = await supabase
      .from('pix_installments')
      .delete()
      .eq('procedure_id', procedureId);
    if (pixError) throw pixError;

    const { error: deleteError } = await supabase
      .from('procedures')
      .delete()
      .eq('id', procedureId);
    if (deleteError) throw deleteError;

    if ((proc as Pick<Procedure, 'appointment_id'> | null)?.appointment_id) {
      await supabase
        .from('appointments')
        .update({ status: 'confirmado' })
        .eq('id', (proc as Pick<Procedure, 'appointment_id'>).appointment_id);
    }

    await refresh();
  };

  return { procedures, loading, error, create, remove, refresh };
}
