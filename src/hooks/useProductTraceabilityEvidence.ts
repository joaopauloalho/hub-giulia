import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { prepareClinicalPhoto } from '../lib/clinicalPhotos';
import { PRODUCT_EVIDENCE_BUCKET, productEvidenceStoragePaths } from '../lib/productTraceability';
import type { ProductEvidenceDraft, ProductEvidenceSource } from '../types/traceability';

interface UploadEvidenceInput {
  patientId: string;
  file: File;
  sourceType: ProductEvidenceSource;
  draftMapId?: string | null;
  draftApplicationId?: string | null;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message ?? '');
  if (/UPLOAD_INCOMPLETE/i.test(message)) return 'A foto ainda não terminou de enviar. Tente novamente.';
  if (/MIME|IMAGE|invalid/i.test(message)) return 'A foto selecionada não é compatível.';
  return 'Não foi possível enviar a foto. Tente novamente.';
}

async function removeObjects(paths: string[]) {
  const { error } = await supabase.storage.from(PRODUCT_EVIDENCE_BUCKET).remove(paths);
  if (error) throw error;
}

export function useProductTraceabilityEvidence() {
  const uploadEvidence = useCallback(async ({ patientId, file, sourceType, draftMapId = null, draftApplicationId = null }: UploadEvidenceInput): Promise<ProductEvidenceDraft> => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const userId = authData.user?.id;
    if (!userId) throw new Error('TRACEABILITY_SESSION_REQUIRED');

    const prepared = await prepareClinicalPhoto(file, sourceType);
    const uploadId = crypto.randomUUID();
    const paths = productEvidenceStoragePaths(userId, patientId, uploadId, prepared.mimeType);

    const { data: draftData, error: draftError } = await supabase.rpc('create_product_traceability_evidence_draft_v1', {
      p_upload_id: uploadId,
      p_patient_id: patientId,
      p_source_type: sourceType,
      p_original_path: paths.original,
      p_preview_path: paths.preview,
      p_thumbnail_path: paths.thumbnail,
      p_mime_type: prepared.mimeType,
      p_width: prepared.width,
      p_height: prepared.height,
      p_size_bytes: prepared.sizeBytes,
      p_sha256: prepared.sha256,
      p_draft_map_id: draftMapId,
      p_draft_application_id: draftApplicationId,
    });
    if (draftError) throw draftError;

    const uploaded: string[] = [];
    try {
      const uploads = [
        [paths.original, prepared.original],
        [paths.preview, prepared.preview],
        [paths.thumbnail, prepared.thumbnail],
      ] as const;
      for (const [path, blob] of uploads) {
        const { error } = await supabase.storage.from(PRODUCT_EVIDENCE_BUCKET).upload(path, blob, {
          cacheControl: '31536000',
          contentType: prepared.mimeType,
          upsert: false,
        });
        if (error) throw error;
        uploaded.push(path);
      }
    } catch (error) {
      if (uploaded.length > 0) {
        try { await removeObjects(uploaded); } catch (cleanupError) { console.warn('[traceability:evidence-cleanup]', cleanupError); }
      }
      try { await supabase.rpc('discard_product_traceability_evidence_draft_v1', { p_upload_id: uploadId }); } catch (cleanupError) { console.warn('[traceability:draft-cleanup]', cleanupError); }
      throw new Error(errorMessage(error));
    }

    const draft = (Array.isArray(draftData) ? draftData[0] : draftData) as ProductEvidenceDraft | null;
    if (!draft) throw new Error('Não foi possível preparar a evidência da foto.');
    return { ...draft, previewUrl: URL.createObjectURL(prepared.thumbnail) };
  }, []);

  const discardEvidence = useCallback(async (evidence: ProductEvidenceDraft) => {
    if (evidence.traceability_id) throw new Error('Esta foto já faz parte do histórico e não pode ser removida silenciosamente.');
    await removeObjects([evidence.original_path, evidence.preview_path, evidence.thumbnail_path]);
    const { error } = await supabase.rpc('discard_product_traceability_evidence_draft_v1', { p_upload_id: evidence.id });
    if (error) throw error;
    if (evidence.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(evidence.previewUrl);
  }, []);

  const listDraftEvidenceForMap = useCallback(async (patientId: string, mapId: string) => {
    const { data, error } = await supabase
      .from('product_traceability_evidence')
      .select('*')
      .eq('patient_id', patientId)
      .eq('draft_map_id', mapId)
      .is('traceability_id', null)
      .is('voided_at', null)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as ProductEvidenceDraft[];
    return await Promise.all(rows.map(async row => {
      const { data: signed, error: signedError } = await supabase.storage.from(PRODUCT_EVIDENCE_BUCKET).createSignedUrl(row.thumbnail_path, 60 * 15);
      if (signedError) return row;
      return { ...row, previewUrl: signed.signedUrl };
    }));
  }, []);

  const getSignedUrl = useCallback(async (path: string, expiresIn = 60 * 15) => {
    const { data, error } = await supabase.storage.from(PRODUCT_EVIDENCE_BUCKET).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  }, []);

  return { uploadEvidence, discardEvidence, listDraftEvidenceForMap, getSignedUrl };
}
