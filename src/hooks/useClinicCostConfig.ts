import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function useClinicCostConfig() {
  const [hourlyRate, setHourlyRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('clinic_cost_settings')
        .select('hourly_rate')
        .maybeSingle();
      if (queryError) throw queryError;
      setHourlyRate(Number(data?.hourly_rate ?? 0));
    } catch (loadError) {
      console.error('[clinic-cost-config:load]', loadError);
      setError('Não foi possível carregar o valor da hora clínica.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (value: number) => {
    const normalized = Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
    setSaving(true);
    setError(null);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Sessão expirada. Entre novamente.');
      const { error: saveError } = await supabase
        .from('clinic_cost_settings')
        .upsert({
          user_id: user.id,
          hourly_rate: normalized,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      if (saveError) throw saveError;
      setHourlyRate(normalized);
      return normalized;
    } catch (saveError) {
      console.error('[clinic-cost-config:save]', saveError);
      setError('Não foi possível salvar o valor da hora clínica.');
      throw saveError;
    } finally {
      setSaving(false);
    }
  }, []);

  return { hourlyRate, loading, saving, error, save, reload: load };
}
