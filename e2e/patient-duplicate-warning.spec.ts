import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

test('aviso de paciente duplicada não bloqueia o cadastro e respeita a clínica', async ({ page }) => {
  const clinicA = await signedInClient('a');
  const clinicB = await signedInClient('b');
  const suffix = Date.now();
  const name = 'Marina Sampaio Alves';
  const phone = '(43) 98888-7766';
  const createdIds: string[] = [];

  let attendanceId: string | null = null;
  let otherClinicId: string | null = null;

  try {
    const existing = await clinicA.from('patients').insert({
      name,
      phone,
      email: `marina-${suffix}@hub-giulia.local`,
      cpf: '52998224725',
    }).select('id').single();
    expect(existing.error).toBeNull();
    createdIds.push(existing.data!.id);

    const attendance = await clinicA.from('procedures').insert({
      patient_id: existing.data!.id,
      performed_at: '2026-08-25T15:00:00.000Z',
      services_ids: [],
      total_value: 100,
      total_cost: 10,
      payment_method: 'pix',
      net_value: 100,
      gross_value: 100,
      covered_value: 0,
    }).select('id').single();
    expect(attendance.error).toBeNull();
    attendanceId = attendance.data!.id;

    const otherClinic = await clinicB.from('patients').insert({
      name,
      phone: '(43) 91111-2222',
    }).select('id').single();
    expect(otherClinic.error).toBeNull();
    otherClinicId = otherClinic.data!.id;
    await browserLogin(page, 'a');
    await page.getByRole('link', { name: 'Pacientes' }).click();
    await page.getByRole('button', { name: /Cadastrar primeira paciente|Nova paciente/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Nova Paciente' });
    await dialog.getByPlaceholder('Nome completo').fill('  Marína   Sampaio   Alves ');
    const warning = dialog.getByTestId('duplicate-patient-warning');
    await expect(warning).toBeVisible({ timeout: 15_000 });
    await expect(warning.getByTestId('duplicate-patient-match')).toHaveCount(1);
    await expect(warning).toContainText(name);
    await expect(warning).toContainText(phone);
    await expect(warning).toContainText('último atendimento 25/08/2026');
    await expect(warning).toContainText('Se for outra pessoa, cadastre mesmo assim.');
    await expect(dialog.getByTestId('new-patient-save')).toHaveText('Cadastrar mesmo assim');

    await warning.getByRole('button', { name: 'Abrir ficha' }).click();
    await expect(page).toHaveURL(new RegExp(`/pacientes/${createdIds[0]}$`));

    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.waitForURL('**/pacientes');
    await page.getByRole('button', { name: 'Nova paciente' }).click();
    const again = page.getByRole('dialog', { name: 'Nova Paciente' });
    const homonym = `Helena Duarte Homônima ${suffix}`;
    await again.getByPlaceholder('Nome completo').fill(homonym);
    await again.getByPlaceholder('(00) 00000-0000').first().fill('+55 43 98888-7766');
    await expect(again.getByTestId('duplicate-patient-warning')).toContainText('mesmo telefone', { timeout: 15_000 });
    await again.getByRole('button', { name: 'Cadastrar mesmo assim' }).click();
    await expect(page.getByText('Paciente cadastrada com sucesso.')).toBeVisible();

    const { data: created, error } = await clinicA.from('patients').select('id,name').eq('name', homonym);
    expect(error).toBeNull();
    expect(created).toHaveLength(1);
    createdIds.push(created![0].id);
    const { data: preserved } = await clinicA.from('patients').select('id').eq('id', createdIds[0]).maybeSingle();
    expect(preserved?.id).toBe(createdIds[0]);
  } finally {
    if (attendanceId) await clinicA.from('procedures').delete().eq('id', attendanceId);
    if (createdIds.length) await clinicA.from('patients').delete().in('id', createdIds);
    if (otherClinicId) await clinicB.from('patients').delete().eq('id', otherClinicId);
  }
});
