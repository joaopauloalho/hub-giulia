import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Material, MaterialDraft } from '../types/materials';

function normalize(row: Record<string, unknown>): Material {
  return {
    ...row,
    unit_cost: Number(row.unit_cost ?? 0),
    stock_quantity: Number(row.stock_quantity ?? 0),
    minimum_stock: Number(row.minimum_stock ?? 0),
    traceability_mode: row.traceability_mode === 'optional' || row.traceability_mode === 'recommended' ? row.traceability_mode : 'none',
  } as Material;
}

export function useMaterials(options: { activeOnly?: boolean } = {}) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase.from('materials').select('*').order('name');
      if (options.activeOnly) query = query.eq('active', true);
      const { data, error: queryError } = await query;
      if (queryError) throw queryError;
      setMaterials(((data ?? []) as Record<string, unknown>[]).map(normalize));
    } catch (err) {
      setMaterials([]);
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os materiais.');
    } finally {
      setLoading(false);
    }
  }, [options.activeOnly]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async (draft: MaterialDraft) => {
    const { data, error: rpcError } = await supabase.rpc('create_material_v2', {
      p_idempotency_key: crypto.randomUUID(),
      p_name: draft.name,
      p_unit_label: draft.unit_label,
      p_unit_cost: draft.unit_cost,
      p_initial_stock: draft.initial_stock,
      p_minimum_stock: draft.minimum_stock,
      p_active: draft.active,
      p_traceability_mode: draft.traceability_mode,
    });
    if (rpcError) throw rpcError;
    await refresh();
    return normalize(data as unknown as Record<string, unknown>);
  };

  const update = async (materialId: string, draft: Omit<MaterialDraft, 'initial_stock'>) => {
    const { data, error: rpcError } = await supabase.rpc('update_material_v2', {
      p_material_id: materialId,
      p_name: draft.name,
      p_unit_label: draft.unit_label,
      p_unit_cost: draft.unit_cost,
      p_minimum_stock: draft.minimum_stock,
      p_active: draft.active,
      p_traceability_mode: draft.traceability_mode,
    });
    if (rpcError) throw rpcError;
    await refresh();
    return normalize(data as unknown as Record<string, unknown>);
  };

  const addStock = async (materialId: string, quantity: number, reason?: string | null) => {
    const { data, error: rpcError } = await supabase.rpc('record_material_stock_entry_v1', {
      p_idempotency_key: crypto.randomUUID(),
      p_material_id: materialId,
      p_quantity: quantity,
      p_reason: reason ?? null,
    });
    if (rpcError) throw rpcError;
    await refresh();
    return normalize(data as unknown as Record<string, unknown>);
  };

  const adjustStock = async (materialId: string, countedQuantity: number, reason: string) => {
    const { data, error: rpcError } = await supabase.rpc('adjust_material_stock_v1', {
      p_idempotency_key: crypto.randomUUID(),
      p_material_id: materialId,
      p_counted_quantity: countedQuantity,
      p_reason: reason,
    });
    if (rpcError) throw rpcError;
    await refresh();
    return normalize(data as unknown as Record<string, unknown>);
  };

  return { materials, loading, error, refresh, create, update, addStock, adjustStock };
}
