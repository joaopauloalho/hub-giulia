import { supabase } from '../lib/supabase';
import { createSignedStorageUrl } from '../lib/storage';
import type { ProposalDiscountType, ProposalEditorItem, ProposalItemPreview, ProposalSummary, TreatmentProposal, TreatmentProposalItem, TreatmentProposalVersion } from '../lib/proposals';

export type ProposalDealContext = {
  deal_id: string; contact_id: string; contact_name: string; patient_id: string | null; title: string; stage: string;
  interests: Array<{ id?: string; service_id: string | null; label: string }>;
};
export type ProposalAttachment = {
  id: string; proposal_id: string; user_id: string; storage_path: string; original_name: string | null; mime_type: string; size_bytes: number | null; sort_order: number; created_at: string; updated_at: string; signed_url?: string | null;
};
export type ProposalDetail = { proposal: TreatmentProposal; versions: TreatmentProposalVersion[]; version: TreatmentProposalVersion; items: TreatmentProposalItem[] };

export async function loadProposalDealContext(dealId: string): Promise<ProposalDealContext> {
  const { data, error } = await supabase.from('crm_pipeline_v').select('*').eq('deal_id', dealId).single(); if (error) throw error; return data as ProposalDealContext;
}

export async function createProposal(dealId: string, title: string) {
  const { data, error } = await supabase.rpc('create_treatment_proposal_v1', { p_deal_id: dealId, p_title: title, p_idempotency_key: crypto.randomUUID() });
  if (error) throw error; const row = (data as Array<{ proposal_id: string; version_id: string; version_number: number; draft_revision: number }> | null)?.[0]; if (!row) throw new Error('PROPOSAL_CREATE_NOT_CONFIRMED'); return row;
}

export async function loadDealProposals(dealId: string): Promise<ProposalSummary[]> {
  const { data, error } = await supabase.from('treatment_proposal_summary_v').select('*').eq('deal_id', dealId).order('proposal_updated_at', { ascending: false }); if (error) throw error; return (data ?? []) as ProposalSummary[];
}
export async function loadPatientProposals(patientId: string): Promise<ProposalSummary[]> {
  const { data, error } = await supabase.rpc('list_patient_treatment_proposals_v1', { p_patient_id: patientId });
  if (error) throw error;
  const summaries = (data ?? []) as ProposalSummary[];
  const versionIds = [...new Set(summaries.map(item => item.version_id).filter(Boolean))];
  if (versionIds.length === 0) return summaries;

  const { data: itemRows, error: itemError } = await supabase
    .from('treatment_proposal_items')
    .select('id,proposal_version_id,service_name_snapshot,quantity,unit_label,sort_order')
    .in('proposal_version_id', versionIds)
    .order('sort_order')
    .order('created_at');
  if (itemError) throw itemError;

  const previewsByVersion = new Map<string, ProposalItemPreview[]>();
  for (const row of itemRows ?? []) {
    const versionId = String(row.proposal_version_id);
    const current = previewsByVersion.get(versionId) ?? [];
    current.push({
      id: String(row.id),
      service_name_snapshot: String(row.service_name_snapshot ?? 'Procedimento'),
      quantity: Number(row.quantity ?? 0),
      unit_label: String(row.unit_label ?? '').trim(),
      sort_order: Number(row.sort_order ?? 0),
    });
    previewsByVersion.set(versionId, current);
  }

  return summaries.map(summary => ({ ...summary, items_preview: previewsByVersion.get(summary.version_id) ?? [] }));
}

export async function loadProposal(proposalId: string, preferredVersionId?: string | null): Promise<ProposalDetail> {
  const [{ data: proposal, error: proposalError }, { data: versions, error: versionsError }] = await Promise.all([
    supabase.from('treatment_proposals').select('*').eq('id', proposalId).single(),
    supabase.from('treatment_proposal_versions').select('*').eq('proposal_id', proposalId).order('version_number', { ascending: false }),
  ]);
  if (proposalError) throw proposalError; if (versionsError) throw versionsError;
  const rows = (versions ?? []) as TreatmentProposalVersion[]; const version = rows.find(item => item.id === preferredVersionId) ?? rows[0]; if (!version) throw new Error('PROPOSAL_VERSION_NOT_FOUND');
  const { data: items, error: itemsError } = await supabase.from('treatment_proposal_items').select('*').eq('proposal_version_id', version.id).order('sort_order').order('created_at');
  if (itemsError) throw itemsError; return { proposal: proposal as TreatmentProposal, versions: rows, version, items: (items ?? []) as TreatmentProposalItem[] };
}

export async function saveProposalDraft(input: {
  versionId: string; expectedRevision: number; title: string; validUntil: string | null; paymentTerms: string; internalNote: string; customerNote: string;
  discountType: ProposalDiscountType; discountValue: string; items: ProposalEditorItem[];
}) {
  const { data, error } = await supabase.rpc('save_treatment_proposal_draft_v2', {
    p_version_id: input.versionId, p_expected_revision: input.expectedRevision, p_title: input.title, p_valid_until: input.validUntil,
    p_payment_terms: input.paymentTerms || null, p_internal_note: input.internalNote || null, p_customer_note: input.customerNote || null,
    p_discount_type: input.discountType, p_discount_value: input.discountValue || '0',
    p_items: input.items.map((item, index) => ({ service_id: item.service_id, service_name_snapshot: item.service_name_snapshot,
      description_snapshot: item.description_snapshot || null, interval_note: item.interval_note || null, payment_condition: item.payment_condition || null,
      quantity: item.quantity, unit_label: item.unit_label, list_unit_price_snapshot: item.list_unit_price_snapshot || '0', offered_unit_price: item.offered_unit_price || '0',
      discount_type: item.discount_type, discount_value: item.discount_value || '0', sort_order: index })),
  });
  if (error) throw error;
  const row = (data as Array<{ draft_revision: number; subtotal: number; item_discount_amount: number; net_subtotal: number; discount_amount: number; total_value: number; updated_at: string }> | null)?.[0];
  if (!row) throw new Error('PROPOSAL_SAVE_NOT_CONFIRMED'); return row;
}

export async function advanceProposalCrm(proposalId: string) {
  const { data, error } = await supabase.rpc('advance_crm_for_treatment_proposal_v1', { p_proposal_id: proposalId }); if (error) throw error; return (data as unknown[] | null)?.[0];
}
export async function deleteProposal(proposalId: string) {
  const { data, error } = await supabase.rpc('delete_treatment_proposal_v2', { p_proposal_id: proposalId }); if (error) throw error; return Boolean(data);
}

export async function loadProposalAttachments(proposalId: string): Promise<ProposalAttachment[]> {
  const { data, error } = await supabase.from('treatment_proposal_attachments').select('*').eq('proposal_id', proposalId).order('sort_order').order('created_at');
  if (error) throw error;
  return Promise.all(((data ?? []) as ProposalAttachment[]).map(async item => ({ ...item, signed_url: await createSignedStorageUrl('proposals', item.storage_path) })));
}

function safeAttachmentName(name: string) {
  const clean = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  return clean || 'imagem';
}

export async function uploadProposalAttachment(proposalId: string, file: File, sortOrder: number): Promise<ProposalAttachment> {
  const allowed = ['image/jpeg','image/png','image/webp','image/heic','image/heif'];
  if (!allowed.includes(file.type)) throw new Error('Use uma imagem JPEG, PNG, WebP ou HEIC.');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('A imagem deve ter até 10 MB.');
  const { data: authData, error: authError } = await supabase.auth.getUser(); if (authError || !authData.user) throw new Error('PROPOSAL_SESSION_REQUIRED');
  const id = crypto.randomUUID();
  const path = `${authData.user.id}/${proposalId}/attachments/${id}/${safeAttachmentName(file.name)}`;
  const { error: storageError } = await supabase.storage.from('proposals').upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (storageError) throw storageError;
  const { data, error } = await supabase.from('treatment_proposal_attachments').insert({ id, proposal_id: proposalId, storage_path: path, original_name: file.name || null, mime_type: file.type, size_bytes: file.size, sort_order: sortOrder }).select('*').single();
  if (error) { await supabase.storage.from('proposals').remove([path]); throw error; }
  return { ...(data as ProposalAttachment), signed_url: await createSignedStorageUrl('proposals', path) };
}

export async function deleteProposalAttachment(attachment: ProposalAttachment) {
  const { error } = await supabase.from('treatment_proposal_attachments').delete().eq('id', attachment.id).eq('proposal_id', attachment.proposal_id); if (error) throw error;
  const { error: storageError } = await supabase.storage.from('proposals').remove([attachment.storage_path]); if (storageError) console.warn('[proposals:attachment-remove]', storageError);
}

export async function reorderProposalAttachments(items: ProposalAttachment[]) {
  for (let index = 0; index < items.length; index += 1) {
    const { error } = await supabase.from('treatment_proposal_attachments').update({ sort_order: index, updated_at: new Date().toISOString() }).eq('id', items[index].id); if (error) throw error;
  }
}

// Legado: mantido somente para leitura de propostas antigas que já possuam PDF.
export async function loadProposalPdf(path: string) { const { data, error } = await supabase.storage.from('proposals').download(path); if (error) throw error; return data; }
export async function proposalSignedUrl(path: string | null | undefined) { return createSignedStorageUrl('proposals', path); }
