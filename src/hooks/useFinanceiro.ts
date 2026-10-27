import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Procedure, PixInstallment, ProcedurePayment } from '../types';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { summarizeFinance } from '../lib/financeIntegrity';
import { POSTGREST_SELECT } from '../lib/postgrestRelationshipHints';

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
          .select(POSTGREST_SELECT.financeProcedures)
          .gte('performed_at', `${start}T00:00:00`)
          .lte('performed_at', `${end}T23:59:59`)
          .order('performed_at', { ascending: false }),
        supabase
          .from('pix_installments')
          .select(POSTGREST_SELECT.financePixPending)
          .is('paid_at', null)
          .order('due_date', { ascending: true }),
        supabase
          .from('procedure_payments')
          .select(POSTGREST_SELECT.financeScheduledPayments)
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
    const { data: current, error: loadError } = await supabase
      .from('procedures').select('revision').eq('id', procedureId).single();
    if (loadError) throw loadError;
    const { error } = await supabase.rpc('cancel_procedure_v1', {
      p_procedure_id: procedureId,
      p_expected_revision: current.revision,
      p_reason: 'Exclusao manual pelo Financeiro',
    });
    if (error) throw error;
    await refresh();
  };

  return { procedures, pixPendentes, pagamentosPendentes, summary, loading, error, refresh, markPixPago, markPagamentoPago, removeProcedure };
}
