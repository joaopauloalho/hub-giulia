import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

test('paciente fictícia com anamnese rascunho pode ser excluída dentro da ficha no iPad', async ({ page }) => {
  const client = await signedInClient('a');
  const { data: auth, error: authError } = await client.auth.getUser();
  expect(authError).toBeNull();
  const ownerId = auth.user!.id;
  const name = `E2E Exclusao Rascunho ${Date.now()}`;
  const { data: patient, error: patientError } = await client.from('patients')
    .insert({ name })
    .select('id').single();
  expect(patientError).toBeNull();

  const { data: anamnesis, error: anamnesisError } = await client.from('anamnesis')
    .insert({ patient_id: patient!.id, user_id: ownerId, conditions: { exemplo: true } })
    .select('id').single();
  expect(anamnesisError).toBeNull();

  await browserLogin(page, 'a');
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.goto(`/pacientes/${patient!.id}`);
  await expect(page.locator('.patient-360-drawer')).toBeVisible();

  await page.getByRole('button', { name: `Excluir definitivamente ${name}` }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Excluir paciente definitivamente?' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('.patient-360-drawer')).toBeVisible();

  const layers = await page.evaluate(() => ({
    confirm: Number(getComputedStyle(document.querySelector('.modal-overlay:has([role="alertdialog"])')!).zIndex),
    drawer: Number(getComputedStyle(document.querySelector('.patient-360-overlay')!).zIndex),
  }));
  expect(layers.confirm).toBeGreaterThan(layers.drawer);

  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.patient-360-drawer')).toBeVisible();
  await page.getByRole('button', { name: `Excluir definitivamente ${name}` }).click();
  await dialog.getByRole('button', { name: 'Excluir definitivamente' }).click();
  await expect(page.getByText('Paciente excluída definitivamente.')).toBeVisible();
  await expect(page).toHaveURL(/\/pacientes$/);

  const { data: removedPatient, error: missingError } = await client.from('patients')
    .select('id').eq('id', patient!.id).maybeSingle();
  expect(missingError).toBeNull();
  expect(removedPatient).toBeNull();

  const { data: removedDraft, error: removedDraftError } = await client.from('anamnesis')
    .select('id').eq('id', anamnesis!.id).maybeSingle();
  expect(removedDraftError).toBeNull();
  expect(removedDraft).toBeNull();
});

test('exclusão continua bloqueada quando existe agenda e CRM', async () => {
  const fixture = JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as { patientId: string; appointmentId: string };
  const client = await signedInClient('a');
  const { error } = await client.rpc('delete_empty_patient_v1', { p_patient_id: fixture.patientId });
  expect(error?.code).toBe('P0001');
  const { data: preserved } = await client.from('patients').select('id').eq('id', fixture.patientId).maybeSingle();
  expect(preserved?.id).toBe(fixture.patientId);
  const { data: appointment } = await client.from('appointments').select('id').eq('id', fixture.appointmentId).maybeSingle();
  expect(appointment?.id).toBe(fixture.appointmentId);
});


test('anamnese finalizada sem assinatura não bloqueia exclusão (e versões são removidas)', async () => {
  const client = await signedInClient('a');
  const { data: auth } = await client.auth.getUser();
  const name = `E2E finalizada sem assinatura ${Date.now()}`;
  const { data: patient, error: patientError } = await client.from('patients')
    .insert({ name }).select('id').single();
  expect(patientError).toBeNull();
  const { data: draft, error: draftError } = await client.from('anamnesis')
    .insert({ patient_id: patient!.id, user_id: auth.user!.id, conditions: { teste: true } })
    .select('id,draft_revision').single();
  expect(draftError).toBeNull();

  const { data: finalized, error: finalizeError } = await client.rpc('finalize_anamnesis_v2', {
    p_patient_id: patient!.id,
    p_expected_revision: draft!.draft_revision,
    p_idempotency_key: crypto.randomUUID(),
  });
  expect(finalizeError).toBeNull();
  expect(finalized).toHaveLength(1);
  const versionId = finalized![0].version_id;

  const { error: deleteError } = await client.rpc('delete_empty_patient_v1', { p_patient_id: patient!.id });
  expect(deleteError).toBeNull();

  for (const [table, id] of [
    ['patients', patient!.id],
    ['anamnesis', draft!.id],
    ['anamnesis_versions', versionId],
  ] as const) {
    const { data, error } = await client.from(table).select('id').eq('id', id).maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  }
});
