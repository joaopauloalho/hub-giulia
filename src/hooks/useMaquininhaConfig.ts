import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { MaquininhaConfig } from '../types';

const DEFAULT_CONFIG: MaquininhaConfig = {
  credito_pct: 2.93,
  debito_pct: 1.39,
  elo_credito_pct: 3.24,
  elo_debito_pct: 1.45,
};

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
        .select('credito_pct, debito_pct, elo_credito_pct, elo_debito_pct')
        .eq('user_id', user.id)
        .maybeSingle();

      if (configError) throw configError;
      setConfig(data ? {
        credito_pct: Number(data.credito_pct),
        debito_pct: Number(data.debito_pct),
        elo_credito_pct: Number(data.elo_credito_pct),
        elo_debito_pct: Number(data.elo_debito_pct),
      } : DEFAULT_CONFIG);
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
          credito_pct: nextConfig.credito_pct,
          debito_pct: nextConfig.debito_pct,
          elo_credito_pct: nextConfig.elo_credito_pct,
          elo_debito_pct: nextConfig.elo_debito_pct,
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
