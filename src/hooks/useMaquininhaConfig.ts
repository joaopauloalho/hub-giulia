import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { CardBrand, MaquininhaConfig, MaquininhaRates } from '../types';

export const DEFAULT_RATES: MaquininhaRates = {
  pix: 0.50,
  master_visa: {
    debito: 1.39,
    '1': 2.93, '2': 4.36, '3': 5.13, '4': 5.89, '5': 6.63,
    '6': 7.37, '7': 7.97, '8': 8.69, '9': 9.41, '10': 10.11,
    '11': 10.82, '12': 11.51, '13': 12.20, '14': 12.88, '15': 13.55,
    '16': 14.22, '17': 14.88, '18': 15.53,
  },
  elo: {
    debito: 1.45,
    '1': 3.24, '2': 4.56, '3': 5.33, '4': 6.09, '5': 6.83,
    '6': 7.57, '7': 8.17, '8': 8.89, '9': 9.61, '10': 10.31,
    '11': 11.02, '12': 11.71, '13': 12.40, '14': 13.08, '15': 13.75,
    '16': 14.42, '17': 15.08, '18': 15.73,
  },
};

const DEFAULT_CONFIG: MaquininhaConfig = { rates: DEFAULT_RATES };

export function getFeePct(
  rates: MaquininhaRates,
  method: string,
  brand: CardBrand,
  installments: number,
): number {
  if (method === 'pix') return rates.pix;
  if (method === 'cartao_debito') return (rates[brand] as Record<string, number>)?.debito ?? 0;
  if (method === 'cartao_credito') return (rates[brand] as Record<string, number>)?.[String(installments)] ?? 0;
  return 0;
}

export function useMaquininhaConfig() {
  const [config, setConfig] = useState<MaquininhaConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Usuário não autenticado.');

      const { data, error: configError } = await supabase
        .from('maquininha_configs')
        .select('rates')
        .eq('user_id', user.id)
        .maybeSingle();

      if (configError) throw configError;
      setConfig(data?.rates ? { rates: data.rates as MaquininhaRates } : DEFAULT_CONFIG);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar taxas da maquininha.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async (nextConfig: MaquininhaConfig) => {
    setSaving(true);
    setError(null);

    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Usuário não autenticado.');

      const { error: saveError } = await supabase
        .from('maquininha_configs')
        .upsert({
          user_id: user.id,
          rates: nextConfig.rates,
          updated_at: new Date().toISOString(),
        });

      if (saveError) throw saveError;
      setConfig(nextConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar taxas da maquininha.';
      setError(message);
      throw new Error(message);
    } finally {
      setSaving(false);
    }
  };

  return { config, loading, saving, error, setConfig, save, refresh };
}
