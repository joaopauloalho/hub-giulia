import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type {
  Appointment,
  Contract,
  ContractTemplate,
  ContractTemplateVersion,
  PreparedContract,
  Procedure,
  ProfessionalProfile,
} from '../types';
import { createSignedStorageUrl } from '../lib/storage';
import { POSTGREST_SELECT } from '../lib/postgrestRelationshipHints';
import { contractErrorMessage } from '../lib/contractUtils';

export type ContractContextOption = {
  key: string;
  type: 'patient' | 'procedure' | 'appointment';
  id: string | null;
  label: string;
  detail: string;
};

function preparedFromRow(row: Contract): PreparedContract {
  if (!row.template_id || !row.template_version_id || !row.document_name_snapshot || !row.rendered_content_snapshot || !row.patient_snapshot || !row.professional_snapshot || !row.services_snapshot || !row.content_sha256 || !row.ready_at) {
    throw new Error('CONTRACT_V2_SNAPSHOT_INCOMPLETE');
  }
  return {
    id: row.id,
    status: row.status,
    template_id: row.template_id,
    template_version_id: row.template_version_id,
    document_name: row.document_name_snapshot,
    rendered_content: row.rendered_content_snapshot,
    patient_snapshot: row.patient_snapshot,
    professional_snapshot: row.professional_snapshot,
    services_snapshot: row.services_snapshot,
    financial_snapshot: row.financial_snapshot,
    context_snapshot: row.context_snapshot ?? {},
    content_sha256: row.content_sha256,
    ready_at: row.ready_at,
  };
}

export function useContracts(patientId: string) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: contractsError } = await supabase
        .from('contracts')
        .select(POSTGREST_SELECT.contracts)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false, nullsFirst: false });
      if (contractsError) throw contractsError;

      const rows = (data ?? []) as Contract[];
      const withDownloads = await Promise.all(rows.map(async contract => {
        const rawPath = contract.pdf_path ?? contract.pdf_url;
        return {
          ...contract,
          pdf_download_url: await createSignedStorageUrl('contracts', rawPath),
        };
      }));
      setContracts(withDownloads);
    } catch (err) {
      console.error('[contracts:list]', err);
      setContracts([]);
      setError('Não foi possível carregar os documentos.');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  return { contracts, loading, error, load };
}

export async function loadContractTemplates(activeOnly = false): Promise<ContractTemplate[]> {
  let query = supabase.from('contract_templates').select('*').order('updated_at', { ascending: false });
  if (activeOnly) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ContractTemplate[];
}

export async function loadContractTemplateVersions(templateId: string): Promise<ContractTemplateVersion[]> {
  const { data, error } = await supabase
    .from('contract_template_versions')
    .select('*')
    .eq('template_id', templateId)
    .order('version_number', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ContractTemplateVersion[];
}

export async function saveContractTemplate(input: { id?: string | null; name: string; body: string }) {
  const { data, error } = await supabase.rpc('save_contract_template_v2', {
    p_template_id: input.id ?? null,
    p_name: input.name,
    p_body: input.body,
  });
  if (error) throw new Error(contractErrorMessage(error));
  return data as { template_id: string; version_id: string; version_number: number; unchanged: boolean };
}

export async function setContractTemplateActive(templateId: string, active: boolean) {
  const { error } = await supabase.rpc('set_contract_template_active_v2', {
    p_template_id: templateId,
    p_active: active,
  });
  if (error) throw error;
}

export async function loadProfessionalProfile(): Promise<ProfessionalProfile | null> {
  const { data, error } = await supabase.from('professional_profiles').select('*').maybeSingle();
  if (error) throw error;
  return data as ProfessionalProfile | null;
}

export async function saveProfessionalProfile(input: {
  display_name: string;
  profession: string;
  professional_registration: string;
}) {
  const { data, error } = await supabase.rpc('upsert_professional_profile_v2', {
    p_display_name: input.display_name,
    p_profession: input.profession || null,
    p_professional_registration: input.professional_registration || null,
  });
  if (error) throw new Error(contractErrorMessage(error));
  return data;
}

export async function loadContractContexts(patientId: string): Promise<ContractContextOption[]> {
  const [{ data: procedureData, error: procedureError }, { data: appointmentData, error: appointmentError }] = await Promise.all([
    supabase
      .from('procedures')
      .select(POSTGREST_SELECT.patientProcedures)
      .eq('patient_id', patientId)
      .order('performed_at', { ascending: false })
      .limit(12),
    supabase
      .from('appointments')
      .select(POSTGREST_SELECT.agenda)
      .eq('patient_id', patientId)
      .order('scheduled_at', { ascending: false })
      .limit(12),
  ]);
  if (procedureError) throw procedureError;
  if (appointmentError) throw appointmentError;

  const procedures = (procedureData ?? []) as Array<Procedure & { procedure_items?: Procedure['items'] }>;
  const appointments = (appointmentData ?? []) as Appointment[];
  const options: ContractContextOption[] = [{
    key: 'patient',
    type: 'patient',
    id: null,
    label: 'Somente paciente',
    detail: 'Sem vínculo com atendimento ou agendamento específico',
  }];

  for (const proc of procedures) {
    const names = (proc.procedure_items ?? proc.items ?? []).map(item => item.name).join(' + ') || 'Atendimento';
    options.push({
      key: `procedure:${proc.id}`,
      type: 'procedure',
      id: proc.id,
      label: names,
      detail: `Atendimento de ${new Date(proc.performed_at).toLocaleDateString('pt-BR')} · ${Number(proc.total_value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    });
  }

  for (const appointment of appointments) {
    options.push({
      key: `appointment:${appointment.id}`,
      type: 'appointment',
      id: appointment.id,
      label: appointment.service?.name ?? 'Consulta',
      detail: `Agendamento de ${new Date(appointment.scheduled_at).toLocaleString('pt-BR')}`,
    });
  }
  return options;
}

export async function prepareContract(input: {
  patientId: string;
  templateId: string;
  context: ContractContextOption;
  idempotencyKey: string;
}): Promise<PreparedContract> {
  const { data, error } = await supabase.rpc('prepare_contract_v2', {
    p_patient_id: input.patientId,
    p_template_id: input.templateId,
    p_procedure_id: input.context.type === 'procedure' ? input.context.id : null,
    p_appointment_id: input.context.type === 'appointment' ? input.context.id : null,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw new Error(contractErrorMessage(error));
  return data as PreparedContract;
}

export async function loadPreparedContract(patientId: string, contractId: string): Promise<PreparedContract> {
  const { data, error } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .eq('patient_id', patientId)
    .single();
  if (error) throw error;
  const row = data as Contract;
  if (row.source_type !== 'v2' || row.status !== 'ready') throw new Error('CONTRACT_NOT_READY');
  return preparedFromRow(row);
}

export async function uploadContractArtifact(contractId: string, filename: 'signature.png' | 'document.pdf', blob: Blob) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('CONTRACT_SESSION_REQUIRED');
  const path = `${user.id}/${contractId}/${filename}`;
  const { error } = await supabase.storage.from('contracts').upload(path, blob, {
    contentType: filename.endsWith('.pdf') ? 'application/pdf' : 'image/png',
    upsert: true,
    cacheControl: '0',
  });
  if (error) throw error;
  return path;
}

export async function finalizePreparedContract(contractId: string, idempotencyKey: string) {
  const { data, error } = await supabase.functions.invoke('contract-finalize', {
    body: { contract_id: contractId, idempotency_key: idempotencyKey },
  });
  if (error) throw new Error(contractErrorMessage(error));
  if ((data as { error?: string } | null)?.error) throw new Error((data as { message?: string }).message ?? 'Não foi possível finalizar o contrato.');
  return data;
}

export async function voidContract(contractId: string, reason: string) {
  const { data, error } = await supabase.rpc('void_contract_v2', {
    p_contract_id: contractId,
    p_reason: reason,
  });
  if (error) throw new Error(contractErrorMessage(error));
  return data;
}
