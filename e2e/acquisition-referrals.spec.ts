import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { browserLogin, signedInClient, anonClient } from './helpers';

const suffix = () => randomUUID().slice(0, 8);

type PatientRow = {
  id: string;
  acquisition_source: string | null;
  referred_by_patient_id: string | null;
  referrer_name: string | null;
};

type AcquisitionSourceRow = {
  source: string | null;
  attended_patients: number;
  procedures: number;
  production_value: number;
};

type AcquisitionReport = { sources: AcquisitionSourceRow[] };

async function insertPatient(client: Awaited<ReturnType<typeof signedInClient>>, data: Record<string, unknown>) {
  const { data: row, error } = await client.from('patients').insert(data).select('id,acquisition_source,referred_by_patient_id,referrer_name').single();
  if (error) throw error;
  return row as PatientRow;
}

test.describe.serial('Hub Giulia 4.2 acquisition and referrals', () => {
  test('DB preserves canonical/manual referral, blocks cross-tenant/self referral and conversion overwrite', async () => {
    const a = await signedInClient('a');
    const b = await signedInClient('b');
    const maria = await insertPatient(a, { name: `Maria Ref ${suffix()}`, acquisition_source: 'instagram' });
    const ana = await insertPatient(a, { name: `Ana Ref ${suffix()}`, acquisition_source: 'referral', referred_by_patient_id: maria.id });
    const manual = await insertPatient(a, { name: `Manual Ref ${suffix()}`, acquisition_source: 'referral', referrer_name: 'Fernanda Souza' });
    expect(ana.referred_by_patient_id).toBe(maria.id);
    expect(manual.referrer_name).toBe('Fernanda Souza');

    const selfId = randomUUID();
    const { error: selfError } = await a.from('patients').insert({ id: selfId, name: `Self ${suffix()}`, acquisition_source: 'referral', referred_by_patient_id: selfId });
    expect(selfError).toBeTruthy();

    const { error: crossError } = await b.from('patients').insert({ name: `Cross ${suffix()}`, acquisition_source: 'referral', referred_by_patient_id: maria.id });
    expect(crossError).toBeTruthy();

    const key = randomUUID();
    const { data: lead, error: leadError } = await a.rpc('create_crm_lead_v2', { p_name: `Lead Referral ${suffix()}`, p_source: 'referral', p_referred_by_patient_id: maria.id, p_idempotency_key: key });
    if (leadError) throw leadError;
    const { data: convertedId, error: convertError } = await a.rpc('convert_crm_contact_to_patient_v1', { p_contact_id: lead.contact_id, p_existing_patient_id: null });
    if (convertError) throw convertError;
    const { data: converted } = await a.from('patients').select('acquisition_source,referred_by_patient_id').eq('id', convertedId).single();
    expect(converted?.acquisition_source).toBe('referral');
    expect(converted?.referred_by_patient_id).toBe(maria.id);
    const { data: convertedAgain } = await a.rpc('convert_crm_contact_to_patient_v1', { p_contact_id: lead.contact_id, p_existing_patient_id: null });
    expect(convertedAgain).toBe(convertedId);

    const existing = await insertPatient(a, { name: `Existing ${suffix()}`, acquisition_source: 'referral', referred_by_patient_id: maria.id });
    const { data: instagramLead, error: instagramLeadError } = await a.rpc('create_crm_lead_v2', { p_name: `Instagram Recent ${suffix()}`, p_source: 'instagram', p_idempotency_key: randomUUID() });
    if (instagramLeadError) throw instagramLeadError;
    const { error: linkError } = await a.rpc('convert_crm_contact_to_patient_v1', { p_contact_id: instagramLead.contact_id, p_existing_patient_id: existing.id });
    if (linkError) throw linkError;
    const { data: existingAfter } = await a.from('patients').select('acquisition_source,referred_by_patient_id').eq('id', existing.id).single();
    expect(existingAfter?.acquisition_source).toBe('referral');
    expect(existingAfter?.referred_by_patient_id).toBe(maria.id);
  });

  test('report deduplicates attended patients, counts procedures and sums performed item value', async () => {
    const a = await signedInClient('a');
    const patient = await insertPatient(a, { name: `Report Instagram ${suffix()}`, acquisition_source: 'instagram' });
    const { data: service, error: serviceError } = await a.from('services').insert({ name: `Service ${suffix()}`, type: 'servico', price: 100, cost_per_unit: 10, active: true, is_injectable: false }).select('id').single();
    if (serviceError) throw serviceError;
    for (let index = 0; index < 4; index += 1) {
      const { data: procedure, error: procedureError } = await a.from('procedures').insert({ patient_id: patient.id, performed_at: new Date().toISOString(), services_ids: [service.id], total_value: 100, total_cost: 10, payment_method: 'pix', net_value: 100, gross_value: 100, covered_value: 0 }).select('id').single();
      if (procedureError) throw procedureError;
      const { error: itemError } = await a.from('procedure_items').insert({ procedure_id: procedure.id, service_id: service.id, name: 'E2E Acquisition Service', qty: 1, list_price: 100, final_price: 100, discount: 0, cost_snapshot: 10, coverage_value_snapshot: 0, amount_due_snapshot: 100 });
      if (itemError) throw itemError;
    }
    const today = new Date();
    const start = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
    const nextMonth = new Date(today.getFullYear(), today.getMonth()+1, 1);
    const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,'0')}-01`;
    const { data: reportData, error: reportError } = await a.rpc('get_acquisition_summary_v1', { p_start_date: start, p_end_date_exclusive: end });
    if (reportError) throw reportError;
    const report = reportData as AcquisitionReport;
    const instagram = report.sources.find(row => row.source === 'instagram');
    expect(instagram).toBeTruthy();
    expect(Number(instagram?.attended_patients)).toBeGreaterThanOrEqual(1);
    expect(Number(instagram?.procedures)).toBeGreaterThanOrEqual(4);
    expect(Number(instagram?.production_value)).toBeGreaterThanOrEqual(400);

    await a.from('patients').update({ archived_at: new Date().toISOString() }).eq('id', patient.id);
    const { data: reportArchivedData, error: archivedError } = await a.rpc('get_acquisition_summary_v1', { p_start_date: start, p_end_date_exclusive: end });
    if (archivedError) throw archivedError;
    const reportArchived = reportArchivedData as AcquisitionReport;
    const archivedInstagram = reportArchived.sources.find(row => row.source === 'instagram');
    expect(Number(archivedInstagram?.procedures)).toBeGreaterThanOrEqual(4);
  });

  test('anonymous report access is denied', async () => {
    const anon = anonClient();
    const { error } = await anon.rpc('get_acquisition_summary_v1', { p_start_date: '2026-08-01', p_end_date_exclusive: '2026-09-01' });
    expect(error).toBeTruthy();
  });

  test('new patient source UX preserves dirty guard and is touch usable', async ({ page }) => {
    await browserLogin(page);
    for (const viewport of [{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1024,height:768},{width:1180,height:820},{width:1366,height:1024},{width:1440,height:900}]) {
      await page.setViewportSize(viewport);
      await page.goto('/pacientes');
      await page.getByRole('button', { name: 'Nova paciente' }).click();
      const select = page.getByTestId('new-patient-acquisition-source');
      await expect(select).toBeVisible();
      const box = await select.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
      await page.getByPlaceholder('Nome completo').fill(`Draft ${suffix()}`);
      await select.selectOption('referral');
      await page.locator('[data-testid="new-patient-backdrop"]').click({ position: { x: 3, y: 3 } });
      await expect(page.getByRole('dialog', { name: 'Nova Paciente' })).toBeVisible();
      await page.getByRole('button', { name: 'Fechar cadastro' }).click();
      await page.getByRole('button', { name: 'Descartar' }).click();
    }
  });

  test('acquisition report page is reachable from CRM', async ({ page }) => {
    await browserLogin(page);
    await page.goto('/crm');
    await page.getByRole('button', { name: 'Aquisição & Indicações' }).click();
    await expect(page.getByTestId('acquisition-page')).toBeVisible();
    await expect(page.getByText('Cadastros no período')).toBeVisible();
    await expect(page.getByText('Pacientes que mais indicaram')).toBeVisible();
  });
});
