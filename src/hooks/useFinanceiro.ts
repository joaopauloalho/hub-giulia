import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Procedure, PixInstallment, ProcedurePayment } from '../types';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { summarizeFinance } from '../lib/financeIntegrity';

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
          .select('*, patient:patients(id, name), payments:procedure_payments(*), items:procedure_items(*)')
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
      const finance = summarizeFinance(procList);

      setProcedures(procList);
      setPixPendentes((pix ?? []) as PixInstallment[]);
      setPagamentosPendentes((pendPayments ?? []) as ProcedurePayment[]);
      setSummary({
        receitaTotal: finance.vendas,
        recebido: finance.liquido,
        pendente: finance.pendente,
        custos: finance.custos,
        lucro: finance.lucro,
      });
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
