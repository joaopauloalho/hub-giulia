import { expect, test } from '@playwright/test';
import { browserLogin, signedInClient } from './helpers';

test('patient list follows saved activity, not only patient registration date', async ({ page }) => {
  const client = await signedInClient('a');
  const { data: userData, error: authError } = await client.auth.getUser();
  expect(authError).toBeNull();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Missing isolated E2E user');

  const unique = `E2E Patient Activity ${Date.now()}`;
  const firstName = `${unique} Antiga`;
  const secondName = `${unique} Nova`;
  const createdIds: string[] = [];

  try {
    const { data: first, error: firstError } = await client
      .from('patients')
      .insert({ user_id: userId, name: firstName })
      .select('id,last_activity_at')
      .single();
    expect(firstError).toBeNull();
    if (!first) throw new Error('First patient not created');
    createdIds.push(first.id);

    const { data: second, error: secondError } = await client
      .from('patients')
      .insert({ user_id: userId, name: secondName })
      .select('id,last_activity_at')
      .single();
    expect(secondError).toBeNull();
    if (!second) throw new Error('Second patient not created');
    createdIds.push(second.id);

    // A note on the older patient must move her ahead of a newer registration.
    const { error: noteError } = await client.from('patient_notes').insert({
      user_id: userId, patient_id: first.id, content: 'E2E clinical note',
    });
    expect(noteError).toBeNull();

    const { data: reordered, error: sortError } = await client.from('patients')
      .select('id,last_activity_at')
      .in('id', createdIds)
      .order('last_activity_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    expect(sortError).toBeNull();
    expect(reordered?.map(patient => patient.id)).toEqual([first.id, second.id]);

    await browserLogin(page, 'a');
    await page.goto('/pacientes');
    await page.getByPlaceholder('Buscar por nome, celular ou email...').fill(unique);
    const items = page.locator('.patient-list .patient-item');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText(firstName);

    // Editing the newer patient's ficha then moves her back to the top.
    const { error: profileError } = await client.from('patients')
      .update({ profession: 'E2E' }).eq('id', second.id);
    expect(profileError).toBeNull();
    await page.reload();
    await page.getByPlaceholder('Buscar por nome, celular ou email...').fill(unique);
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText(secondName);
  } finally {
    if (createdIds.length) await client.from('patients').delete().in('id', createdIds);
  }
});
