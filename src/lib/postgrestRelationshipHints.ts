export const POSTGREST_SELECT = {
  agenda:
    '*, patient:patients!appointments_patient_owner_fkey(id,name,phone), service:services!appointments_service_owner_fkey(id,name,duration_minutes)',
  agendaConflict:
    'id, scheduled_at, duration_minutes, status, patient:patients!appointments_patient_owner_fkey(id,name)',
  financeProcedures:
    '*, patient:patients!procedures_patient_owner_fkey(id,name), payments:procedure_payments!procedure_payments_procedure_owner_fkey(*), items:procedure_items!procedure_items_procedure_owner_fkey(*)',
  financePixPending:
    '*, procedure:procedures!pix_installments_procedure_owner_fkey(id,patient_id,total_value,patient:patients!procedures_patient_owner_fkey(id,name))',
  financeScheduledPayments:
    '*, procedure:procedures!procedure_payments_procedure_owner_fkey(id,patient_id,total_value,patient:patients!procedures_patient_owner_fkey(id,name))',
  patientProcedures:
    '*, procedure_items:procedure_items!procedure_items_procedure_owner_fkey(*), procedure_payments:procedure_payments!procedure_payments_procedure_owner_fkey(*)',
  patientNotes:
    '*, patient:patients!patient_notes_patient_owner_fkey(id,name)',
  patientPhotos:
    '*, procedure:procedures!patient_photos_procedure_owner_fkey(id,performed_at,services_ids)',
  contracts:
    '*, template:contract_templates!contracts_template_owner_fkey(name)',
} as const;
