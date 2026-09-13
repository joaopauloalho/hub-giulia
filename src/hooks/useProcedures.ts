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
  item_costs?: Array<{ service_id: string; cost: number }>;
  clinical_minutes?: number;
  parent_procedure_id?: string | null;
}

type AttendanceServiceRow = {
  id: string;
  name: string;
  type: string;
  price: number;
  cost_per_unit: number;
};

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
        const isReturn = Boolean(input.parent_procedure_id);
        const coverageEntries = isReturn ? [] : (input.coverage_entries ?? []);
        const materialEntries = input.material_entries ?? [];
        const paymentInput = isReturn ? [] : (input.payment_entries ?? []);
        if (!isReturn && input.total_value > 0.02 && paymentInput.length === 0) throw new Error('ATTENDANCE_PAYMENTS_REQUIRED');

        const { data: serviceRows, error: servicesError } = await supabase
          .from('services')
          .select('id, name, type, price, cost_per_unit')
          .in('id', input.services_ids);
        if (servicesError) throw servicesError;

        const normalizedServices = (serviceRows ?? []).map(service => ({
          ...service,
          price: Number(service.price),
          cost_per_unit: Number(service.cost_per_unit ?? 0),
        })) as AttendanceServiceRow[];
        const serviceById = new Map(normalizedServices.map(service => [service.id, service]));
        const priceByService = new Map(normalizedServices.map(service => [service.id, service.price]));
        const explicitItems = new Map((input.item_values ?? []).map(item => [item.service_id, item]));
        const items = input.services_ids.map(serviceId => {
          const explicit = explicitItems.get(serviceId);
          const price = isReturn ? 0 : (explicit?.final_price ?? priceByService.get(serviceId));
          const qty = explicit?.qty ?? 1;
          if (price === undefined || !Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) throw new Error('ATTENDANCE_SERVICE_FORBIDDEN');
          return { service_id: serviceId, qty, final_price: Number(price) };
        });

        const coveredServiceIds = new Set(coverageEntries.map(entry => entry.service_id));
        const purchasedComboIds = new Set(
          isReturn
            ? []
            : items
                .filter(item => serviceById.get(item.service_id)?.type === 'combo' && !coveredServiceIds.has(item.service_id))
                .map(item => item.service_id),
        );
        const requestedCostByService = new Map((input.item_costs ?? []).map(item => [item.service_id, Number(item.cost)]));
        const itemCosts = (input.item_costs ?? []).map(item => ({
          service_id: item.service_id,
          // O custo do combo é o custo previsto do protocolo inteiro. A venda, por si só,
          // não realiza esse custo clínico; os custos reais entram nas sessões seguintes.
          cost: purchasedComboIds.has(item.service_id) ? 0 : Number(item.cost),
        }));
        if (itemCosts.some(item => !Number.isFinite(item.cost) || item.cost < 0)) throw new Error('ATTENDANCE_COSTS_INVALID');

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
          clinical_minutes: input.clinical_minutes,
          injectable_maps: injectableDraft ? [] : (injectablePoints.length > 0 ? [{ points: injectablePoints }] : []),
          injectable_draft_id: injectableDraft?.mapId ?? null,
          injectable_draft_revision: injectableDraft?.revision ?? null,
          parent_procedure_id: input.parent_procedure_id ?? null,
          notes: input.notes ?? null,
        });

        let finalizedProcedure = procedure;
        if (itemCosts.length) {
          const { data: costAdjusted, error: costError } = await supabase.rpc('set_procedure_item_costs_v1', {
            p_procedure_id: procedure.id,
            p_costs: itemCosts,
          });
          if (costError) throw costError;
          if (!costAdjusted) throw new Error('ATTENDANCE_COSTS_EMPTY_RESPONSE');
          finalizedProcedure = costAdjusted as Procedure;
        }

        // Venda direta de um combo vira um protocolo ativo. O RPC é idempotente pelo
        // par atendimento + combo; se houver falha depois do atendimento atômico, uma
        // nova tentativa reaproveita o mesmo atendimento em vez de duplicar a venda.
        for (const item of items) {
          if (!purchasedComboIds.has(item.service_id)) continue;
          const service = serviceById.get(item.service_id);
          if (!service) continue;
          const estimatedCost = requestedCostByService.get(item.service_id) ?? service.cost_per_unit;
          const { error: protocolError } = await supabase.rpc('create_protocol_from_attendance_v1', {
            p_procedure_id: procedure.id,
            p_service_id: item.service_id,
            p_commercial_value: item.final_price,
            p_estimated_cost: estimatedCost,
            p_quantity: item.qty,
          });
          if (protocolError) throw protocolError;
        }

        if (injectableDraft || injectablePoints.length > 0) markAtomicAttendanceProcedure(procedure.id);
        clearAttendanceInjectableDraft();
        clearAttendanceInjectablePoints();
        idempotencyKeyRef.current = null;
        performedAtRef.current = null;
        await refresh();
        return finalizedProcedure;
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
