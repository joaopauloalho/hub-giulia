import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Procedure, PixInstallment } from '../types';
import { startOfMonth, endOfMonth, format } from 'date-fns';

export interface FinanceiroSummary {
  receita: number;
  custos: number;
  lucro: number;
}

export function useFinanceiro(month: Date) {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [pixPendentes, setPixPendentes] = useState<PixInstallment[]>([]);
  const [summary, setSummary] = useState<FinanceiroSummary>({ receita: 0, custos: 0, lucro: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);

    const start = format(startOfMonth(month), 'yyyy-MM-dd');
    const end = format(endOfMonth(month), 'yyyy-MM-dd');

    const [{ data: procs }, { data: pix }] = await Promise.all([
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

    const procList = (procs ?? []) as Procedure[];
    const pixList = (pix ?? []) as PixInstallment[];

    const receita = procList.reduce((s, p) => s + p.total_value, 0);
    const custos = procList.reduce((s, p) => s + p.total_cost, 0);
    const lucro = procList.reduce((s, p) => s + p.net_value - p.total_cost, 0);

    setProcedures(procList);
    setPixPendentes(pixList);
    setSummary({ receita, custos, lucro });
    setLoading(false);
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

  return { procedures, pixPendentes, summary, loading, refresh, markPixPago };
}
