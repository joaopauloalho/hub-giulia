import { supabase } from '../lib/supabase';
import { createSignedStorageUrl } from '../lib/storage';
import type { ProposalDiscountType, ProposalEditorItem, ProposalSummary, TreatmentProposal, TreatmentProposalItem, TreatmentProposalVersion } from '../lib/proposals';

export type ProposalDealContext = {
  deal_id: string; contact_id: string; contact_name: string; patient_id: string | null; title: string; stage: string;
  interests: Array<{ id?: string; service_id: string | null; label: string }>;
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
  const { data, error } = await supabase.rpc('list_patient_treatment_proposals_v1', { p_patient_id: patientId }); if (error) throw error; return (data ?? []) as ProposalSummary[];
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

export async function issueProposal(versionId: string, expectedRevision: number, idempotencyKey: string) {
  const { data, error } = await supabase.rpc('issue_treatment_proposal_v1', { p_version_id: versionId, p_expected_revision: expectedRevision, p_idempotency_key: idempotencyKey }); if (error) throw error; return (data as unknown[] | null)?.[0];
}
export async function createProposalRevision(sourceVersionId: string, idempotencyKey = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc('create_treatment_proposal_revision_v1', { p_source_version_id: sourceVersionId, p_idempotency_key: idempotencyKey }); if (error) throw error;
  const row = (data as Array<{ proposal_id: string; version_id: string; version_number: number; draft_revision: number }> | null)?.[0]; if (!row) throw new Error('PROPOSAL_REVISION_NOT_CONFIRMED'); return row;
}
export async function markProposalSent(versionId: string, idempotencyKey = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc('mark_treatment_proposal_sent_v1', { p_version_id: versionId, p_idempotency_key: idempotencyKey }); if (error) throw error; return (data as unknown[] | null)?.[0];
}
export async function acceptProposal(versionId: string, markDealWon: boolean, idempotencyKey = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc('accept_treatment_proposal_v1', { p_version_id: versionId, p_mark_deal_won: markDealWon, p_idempotency_key: idempotencyKey }); if (error) throw error; return (data as unknown[] | null)?.[0];
}
export async function declineProposal(versionId: string, reason: string, idempotencyKey = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc('decline_treatment_proposal_v1', { p_version_id: versionId, p_reason: reason || null, p_idempotency_key: idempotencyKey }); if (error) throw error; return (data as unknown[] | null)?.[0];
}
export async function voidProposal(versionId: string, reason: string, idempotencyKey = crypto.randomUUID()) {
  const { data, error } = await supabase.rpc('void_treatment_proposal_v1', { p_version_id: versionId, p_reason: reason, p_idempotency_key: idempotencyKey }); if (error) throw error; return (data as unknown[] | null)?.[0];
}

async function sha256(blob: Blob) { const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function uploadProposalPdf(proposalId: string, versionId: string, blob: Blob) {
  const { data: authData, error: authError } = await supabase.auth.getUser(); if (authError || !authData.user) throw new Error('PROPOSAL_SESSION_REQUIRED');
  const path = `${authData.user.id}/${proposalId}/${versionId}/proposal.pdf`; let artifact = blob;
  const { error } = await supabase.storage.from('proposals').upload(path, blob, { contentType: 'application/pdf', cacheControl: '0', upsert: false });
  if (error) { if (!/exist|duplicate/i.test(error.message)) throw error; const { data: existing, error: downloadError } = await supabase.storage.from('proposals').download(path); if (downloadError || !existing) throw downloadError ?? error; artifact = existing; }
  const hash = await sha256(artifact); const { error: attachError } = await supabase.rpc('attach_treatment_proposal_pdf_v1', { p_version_id: versionId, p_pdf_path: path, p_pdf_sha256: hash }); if (attachError) throw attachError; return { path, hash, blob: artifact };
}
export async function loadProposalPdf(path: string) { const { data, error } = await supabase.storage.from('proposals').download(path); if (error) throw error; return data; }
export async function proposalSignedUrl(path: string | null | undefined) { return createSignedStorageUrl('proposals', path); }
export async function shareProposalFile(blob: Blob, title: string) {
  const safeName = `${title || 'proposta'}.pdf`.replace(/[^a-zA-Z0-9À-ÿ._ -]+/g, '').replace(/\s+/g, '-'); const file = new File([blob], safeName, { type: 'application/pdf' }); const sharePayload = { title, files: [file] };
  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(sharePayload))) { await navigator.share(sharePayload); return 'shared' as const; }
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = safeName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); return 'downloaded' as const;
}
