import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Procedure, PixInstallment } from '../types';
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
  const [summary, setSummary] = useState<FinanceiroSummary>({ receitaTotal: 0, recebido: 0, pendente: 0, custos: 0, lucro: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const start = format(startOfMonth(month), 'yyyy-MM-dd');
      const end = format(endOfMonth(month), 'yyyy-MM-dd');

      const [{ data: procs, error: procsError }, { data: pix, error: pixError }] = await Promise.all([
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
      ]);

      if (procsError) throw procsError;
      if (pixError) throw pixError;

      const procList = (procs ?? []) as Procedure[];
      const procIds = procList.map(proc => proc.id);
      const { data: monthlyPix, error: monthlyPixError } = procIds.length > 0
        ? await supabase.from('pix_installments').select('*').in('procedure_id', procIds)
        : { data: [], error: null };

      if (monthlyPixError) throw monthlyPixError;

      const pixList = (pix ?? []) as PixInstallment[];
      const monthlyPixList = (monthlyPix ?? []) as PixInstallment[];

      const paidPixByProcedure = monthlyPixList.reduce<Record<string, number>>((acc, installment) => {
        if (installment.paid_at) {
          acc[installment.procedure_id] = (acc[installment.procedure_id] ?? 0) + installment.amount;
        }
        return acc;
      }, {});

      const receitaTotal = procList.reduce((sum, proc) => sum + proc.total_value, 0);
      const custos = procList.reduce((sum, proc) => sum + proc.total_cost, 0);
      const recebido = procList.reduce((sum, proc) => {
        if (proc.payment_method === 'pix_parcelado') {
          return sum + (paidPixByProcedure[proc.id] ?? 0);
        }

        return sum + proc.net_value;
      }, 0);
      const pendente = Math.max(receitaTotal - recebido, 0);
      const lucro = recebido - custos;

      setProcedures(procList);
      setPixPendentes(pixList);
      setSummary({ receitaTotal, recebido, pendente, custos, lucro });
    } catch (err) {
      setProcedures([]);
      setPixPendentes([]);
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

  return { procedures, pixPendentes, summary, loading, error, refresh, markPixPago };
}
