import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type ComboCompositionItem = {
  id: string;
  combo_service_id: string;
  component_service_id: string;
  quantity: number;
  sort_order: number;
};

export type ComboCompositionDraftItem = {
  component_service_id: string;
  quantity: number;
};

export async function fetchComboComposition(comboServiceId: string) {
  const { data, error } = await supabase
    .from('service_combo_items')
    .select('id,combo_service_id,component_service_id,quantity,sort_order')
    .eq('combo_service_id', comboServiceId)
    .order('sort_order')
    .order('id');
  if (error) throw error;
  return (data ?? []).map(row => ({ ...row, quantity: Number(row.quantity) })) as ComboCompositionItem[];
}

export async function replaceComboComposition(comboServiceId: string, items: ComboCompositionDraftItem[]) {
  const { data, error } = await supabase.rpc('replace_service_combo_items_v1', {
    p_combo_service_id: comboServiceId,
    p_items: items.map(item => ({
      component_service_id: item.component_service_id,
      quantity: Number(item.quantity),
    })),
  });
  if (error) throw error;
  return data;
}

export function useComboComposition(comboServiceId?: string | null) {
  const [items, setItems] = useState<ComboCompositionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!comboServiceId) {
      setItems([]);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      setItems(await fetchComboComposition(comboServiceId));
      setError(null);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err : new Error('Falha ao carregar a composição do combo.'));
    } finally {
      setLoading(false);
    }
  }, [comboServiceId]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { items, loading, error, refresh };
}
