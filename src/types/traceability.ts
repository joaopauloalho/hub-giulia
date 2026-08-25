export type TraceabilityMode = 'none' | 'optional' | 'recommended';
export type ProductEvidenceSource = 'camera' | 'library' | 'upload';
export type ProductTraceabilitySourceKind = 'injectable_application' | 'procedure_material';
export type ProductTraceabilityStatus = 'active' | 'reverted' | 'voided';

export interface ProductEvidenceDraft {
  id: string;
  client_upload_id: string;
  user_id: string;
  patient_id: string;
  traceability_id: string | null;
  draft_map_id: string | null;
  draft_application_id: string | null;
  original_path: string;
  preview_path: string;
  thumbnail_path: string;
  mime_type: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  size_bytes: number;
  sha256: string;
  source_type: ProductEvidenceSource;
  created_at: string;
  created_by: string;
  attached_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  previewUrl?: string | null;
}

export interface ProcedureProductTraceability {
  id: string;
  user_id: string;
  patient_id: string;
  procedure_id: string | null;
  procedure_id_snapshot: string;
  performed_at_snapshot: string;
  source_kind: ProductTraceabilitySourceKind;
  source_ref_snapshot: string;
  injectable_application_id: string | null;
  procedure_material_id: string | null;
  injectable_product_id: string | null;
  material_id: string | null;
  product_ref_snapshot: string;
  product_name_snapshot: string;
  brand_snapshot: string | null;
  presentation_snapshot: string | null;
  lot_number_snapshot: string | null;
  expires_on_snapshot: string | null;
  quantity_snapshot: number;
  unit_snapshot: string;
  traceability_mode_snapshot: TraceabilityMode;
  status: ProductTraceabilityStatus;
  procedure_reverted_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
  created_by: string;
}

export interface ProcedureTraceabilityWithEvidence extends ProcedureProductTraceability {
  evidence: ProductEvidenceDraft | null;
}
