import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Procedure, PixInstallment, ProcedurePayment } from '../types';
import { startOfMonth, endOfMonth, format } from 'date-fns';

export interface FinanceiroSummary {
  receitaTotal: number;
  recebido: number;
  pendente: number;
  custos: number;
  lucro: number;
}

export function useFinanceiro(month: Date) {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [pixPendentes, setPixPendentes] = useState<PixInstallment[]>([]);
  const [pagamentosPendentes, setPagamentosPendentes] = useState<ProcedurePayment[]>([]);
  const [summary, setSummary] = useState<FinanceiroSummary>({ receitaTotal: 0, recebido: 0, pendente: 0, custos: 0, lucro: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const start = format(startOfMonth(month), 'yyyy-MM-dd');
      const end = format(endOfMonth(month), 'yyyy-MM-dd');

      const [
        { data: procs, error: procsError },
        { data: pix, error: pixError },
        { data: pendPayments, error: pendErr },
      ] = await Promise.all([
        supabase
          .from('procedures')
          .select('*, patient:patients(id, name)')
          .gte('performed_at', `${start}T00:00:00`)
          .lte('performed_at', `${end}T23:59:59`)
          .order('performed_at', { ascending: false }),
        supabase
          .from('pix_installments')
          .select('*, procedure:procedures(id, patient_id, total_value, patient:patients(id, name))')
          .is('paid_at', null)
          .order('due_date', { ascending: true }),
        supabase
          .from('procedure_payments')
          .select('*, procedure:procedures(id, patient_id, total_value, patient:patients(id, name))')
          .is('paid_at', null)
          .not('scheduled_date', 'is', null)
          .order('scheduled_date', { ascending: true }),
      ]);

      if (procsError) throw procsError;
      if (pixError) throw pixError;
      if (pendErr) throw pendErr;

      const procList = (procs ?? []) as Procedure[];
      const procIds = procList.map(p => p.id);
      const { data: monthlyPix, error: monthlyPixError } = procIds.length > 0
        ? await supabase.from('pix_installments').select('*').in('procedure_id', procIds)
        : { data: [], error: null };

      if (monthlyPixError) throw monthlyPixError;

      const pixList = (pix ?? []) as PixInstallment[];
      const monthlyPixList = (monthlyPix ?? []) as PixInstallment[];

      const paidPixByProcedure = monthlyPixList.reduce<Record<string, number>>((acc, inst) => {
        if (inst.paid_at) acc[inst.procedure_id] = (acc[inst.procedure_id] ?? 0) + inst.amount;
        return acc;
      }, {});

      const receitaTotal = procList.reduce((s, p) => s + p.total_value, 0);
      const custos = procList.reduce((s, p) => s + p.total_cost, 0);
      const recebido = procList.reduce((s, p) => {
        if (p.payment_method === 'pix_parcelado') return s + (paidPixByProcedure[p.id] ?? 0);
        return s + p.net_value;
      }, 0);
      const pendente = Math.max(receitaTotal - recebido, 0);
      const lucro = recebido - custos;

      setProcedures(procList);
      setPixPendentes(pixList);
      setPagamentosPendentes((pendPayments ?? []) as ProcedurePayment[]);
      setSummary({ receitaTotal, recebido, pendente, custos, lucro });
    } catch (err) {
      setProcedures([]);
      setPixPendentes([]);
      setPagamentosPendentes([]);
      setSummary({ receitaTotal: 0, recebido: 0, pendente: 0, custos: 0, lucro: 0 });
      setError(err instanceof Error ? err.message : 'Erro ao carregar financeiro.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  const markPixPago = async (installmentId: string) => {
    const { error } = await supabase
      .from('pix_installments')
      .update({ paid_at: new Date().toISOString() })
      .eq('id', installmentId);
    if (error) throw error;
    await refresh();
  };

  const markPagamentoPago = async (id: string) => {
    const { error } = await supabase
      .from('procedure_payments')
      .update({ paid_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    await refresh();
  };

  const removeProcedure = async (procedureId: string) => {
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

    const appointmentId = (proc as { appointment_id: string | null } | null)?.appointment_id;
    if (appointmentId) {
      await supabase
        .from('appointments')
        .update({ status: 'confirmado' })
        .eq('id', appointmentId);
    }

    await refresh();
  };

  return { procedures, pixPendentes, pagamentosPendentes, summary, loading, error, refresh, markPixPago, markPagamentoPago, removeProcedure };
}
