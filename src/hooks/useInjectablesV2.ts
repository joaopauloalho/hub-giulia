import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  formatQuantity,
  type InjectableApplicationDraftV2,
  type InjectableDraftMapV2,
  type InjectableLotV2,
  type InjectablePointV2,
  type InjectableProductV2,
} from '../lib/injectablesV2';

interface ApplicationRow {
  id: string;
  map_id: string;
  service_id: string;
  product_id: string;
  lot_id: string | null;
  color_snapshot: string;
  dilution_note: string | null;
  created_at: string;
}

interface PointRow {
  id: string;
  application_id: string;
  x: string | number;
  y: string | number;
  quantity: string | number;
  region: string | null;
  side: InjectablePointV2['side'] | null;
  note: string | null;
  created_at: string;
}

function friendlyError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

export function useInjectablesV2(patientId?: string) {
  const [draft, setDraft] = useState<InjectableDraftMapV2 | null>(null);
  const [applications, setApplications] = useState<InjectableApplicationDraftV2[]>([]);
  const [products, setProducts] = useState<InjectableProductV2[]>([]);
  const [lots, setLots] = useState<InjectableLotV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    const [productsResult, lotsResult] = await Promise.all([
      supabase
        .from('injectable_products')
        .select('*')
        .order('active', { ascending: false })
        .order('name', { ascending: true }),
      supabase
        .from('injectable_product_lots')
        .select('*')
        .order('active', { ascending: false })
        .order('expires_on', { ascending: true, nullsFirst: false }),
    ]);

    if (productsResult.error) throw productsResult.error;
    if (lotsResult.error) throw lotsResult.error;
    setProducts((productsResult.data ?? []) as InjectableProductV2[]);
    setLots((lotsResult.data ?? []) as InjectableLotV2[]);
  }, []);

  const loadStructuredDraft = useCallback(async (map: InjectableDraftMapV2) => {
    const [applicationsResult, pointsResult] = await Promise.all([
      supabase
        .from('injectable_applications')
        .select('id,map_id,service_id,product_id,lot_id,color_snapshot,dilution_note,created_at')
        .eq('map_id', map.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('injectable_application_points')
        .select('id,application_id,x,y,quantity,region,side,note,created_at')
        .eq('map_id', map.id)
        .order('created_at', { ascending: true }),
    ]);

    if (applicationsResult.error) throw applicationsResult.error;
    if (pointsResult.error) throw pointsResult.error;

    const pointRows = (pointsResult.data ?? []) as PointRow[];
    const pointsByApplication = new Map<string, InjectablePointV2[]>();
    for (const point of pointRows) {
      const list = pointsByApplication.get(point.application_id) ?? [];
      list.push({
        id: point.id,
        x: Number(point.x),
        y: Number(point.y),
        quantity: formatQuantity(point.quantity),
        region: point.region ?? '',
        side: point.side ?? '',
        note: point.note ?? '',
      });
      pointsByApplication.set(point.application_id, list);
    }

    const restored = ((applicationsResult.data ?? []) as ApplicationRow[]).map(application => ({
      id: application.id,
      service_id: application.service_id,
      product_id: application.product_id,
      lot_id: application.lot_id,
      color: application.color_snapshot,
      dilution_note: application.dilution_note ?? '',
      points: pointsByApplication.get(application.id) ?? [],
    }));

    setApplications(restored);
    return restored;
  }, []);

  const openDraft = useCallback(async () => {
    if (!patientId) throw new Error('Paciente não selecionada.');
    setLoading(true);
    setError(null);
    try {
      const [draftResult] = await Promise.all([
        supabase.rpc('create_injectable_draft_v2', {
          p_patient_id: patientId,
          p_map_type: 'face',
        }),
        loadCatalog(),
      ]);

      if (draftResult.error) throw draftResult.error;
      if (!draftResult.data) throw new Error('Draft de injetáveis não foi criado.');

      const map = draftResult.data as InjectableDraftMapV2;
      setDraft(map);
      await loadStructuredDraft(map);
      return map;
    } catch (cause) {
      const message = friendlyError(cause, 'Não foi possível abrir o mapa de injetáveis.');
      setError(message);
      throw cause;
    } finally {
      setLoading(false);
    }
  }, [loadCatalog, loadStructuredDraft, patientId]);

  const saveDraft = useCallback(async (
    nextApplications: InjectableApplicationDraftV2[],
    expectedRevision?: number,
  ) => {
    const current = draft;
    if (!current) throw new Error('Draft de injetáveis não está aberto.');
    const revision = expectedRevision ?? current.revision;

    const { data, error: saveError } = await supabase.rpc('save_injectable_draft_v2', {
      p_map_id: current.id,
      p_expected_revision: revision,
      p_applications: nextApplications.map(application => ({
        id: application.id,
        service_id: application.service_id,
        product_id: application.product_id,
        lot_id: application.lot_id,
        color: application.color,
        dilution_note: application.dilution_note || null,
        points: application.points.map(point => ({
          id: point.id,
          x: point.x,
          y: point.y,
          quantity: point.quantity,
          region: point.region || null,
          side: point.side || null,
          note: point.note || null,
        })),
      })),
    });

    if (saveError) throw saveError;
    if (!data) throw new Error('Draft não retornou após salvar.');

    const nextMap = data as InjectableDraftMapV2;
    setDraft(nextMap);
    return nextMap;
  }, [draft]);

  const discardDraft = useCallback(async (expectedRevision?: number) => {
    if (!draft) return true;
    const { data, error: discardError } = await supabase.rpc('discard_injectable_draft_v2', {
      p_map_id: draft.id,
      p_expected_revision: expectedRevision ?? draft.revision,
    });
    if (discardError) throw discardError;
    setDraft(null);
    setApplications([]);
    return Boolean(data);
  }, [draft]);

  const createProduct = useCallback(async (input: {
    name: string;
    default_unit: string;
    category?: string;
    brand?: string;
    substance?: string;
    presentation?: string;
  }) => {
    const { data, error: createError } = await supabase
      .from('injectable_products')
      .insert({
        name: input.name.trim(),
        default_unit: input.default_unit.trim(),
        category: input.category?.trim() || null,
        brand: input.brand?.trim() || null,
        substance: input.substance?.trim() || null,
        presentation: input.presentation?.trim() || null,
      })
      .select('*')
      .single();
    if (createError) throw createError;
    const product = data as InjectableProductV2;
    setProducts(current => [...current, product].sort((a, b) => a.name.localeCompare(b.name)));
    return product;
  }, []);

  const createLot = useCallback(async (input: {
    product_id: string;
    lot_number: string;
    expires_on?: string;
  }) => {
    const { data, error: createError } = await supabase
      .from('injectable_product_lots')
      .insert({
        product_id: input.product_id,
        lot_number: input.lot_number.trim(),
        expires_on: input.expires_on || null,
      })
      .select('*')
      .single();
    if (createError) throw createError;
    const lot = data as InjectableLotV2;
    setLots(current => [...current, lot]);
    return lot;
  }, []);

  return {
    draft,
    applications,
    setApplications,
    products,
    lots,
    loading,
    error,
    openDraft,
    saveDraft,
    discardDraft,
    loadCatalog,
    createProduct,
    createLot,
  };
}
