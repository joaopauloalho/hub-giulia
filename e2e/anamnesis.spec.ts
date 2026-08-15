import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type E2EState = { patientId: string };
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

test('anamnesis draft uses optimistic revisioning and finalization is idempotent', async () => {
  const seeded = await readState();
  const a = await signedInClient('a');
  const b = await signedInClient('b');
  const answers = {
    conditions: { diabetes: false, hypertension: false },
    medications: '',
    medications_status: 'none',
    allergies: '',
    allergies_status: 'none',
    surgical_history: {},
    habits: {},
    aesthetics: { notes: 'E2E TEST non-sensitive draft' },
  };

  const created = await a.rpc('save_anamnesis_draft_v2', {
    p_patient_id: seeded.patientId,
    p_expected_revision: 0,
    p_answers: answers,
    p_form_schema_version: 2,
  });
  expect(created.error).toBeNull();
  const createdRow = Array.isArray(created.data) ? created.data[0] : created.data;
  expect(createdRow?.draft_revision).toBe(1);
  expect(createdRow?.status).toBe('draft');

  const stale = await a.rpc('save_anamnesis_draft_v2', {
    p_patient_id: seeded.patientId,
    p_expected_revision: 0,
    p_answers: answers,
    p_form_schema_version: 2,
  });
  expect(stale.error).not.toBeNull();

  const updated = await a.rpc('save_anamnesis_draft_v2', {
    p_patient_id: seeded.patientId,
    p_expected_revision: 1,
    p_answers: { ...answers, aesthetics: { notes: 'E2E TEST revision 2' } },
    p_form_schema_version: 2,
  });
  expect(updated.error).toBeNull();
  const updatedRow = Array.isArray(updated.data) ? updated.data[0] : updated.data;
  expect(updatedRow?.draft_revision).toBe(2);

  const idempotencyKey = randomUUID();
  const [first, second] = await Promise.all([
    a.rpc('finalize_anamnesis_v2', {
      p_patient_id: seeded.patientId,
      p_expected_revision: 2,
      p_idempotency_key: idempotencyKey,
    }),
    a.rpc('finalize_anamnesis_v2', {
      p_patient_id: seeded.patientId,
      p_expected_revision: 2,
      p_idempotency_key: idempotencyKey,
    }),
  ]);
  expect(first.error).toBeNull();
  expect(second.error).toBeNull();
  const firstVersion = Array.isArray(first.data) ? first.data[0] : first.data;
  const secondVersion = Array.isArray(second.data) ? second.data[0] : second.data;
  expect(firstVersion?.version_id).toBeTruthy();
  expect(secondVersion?.version_id).toBe(firstVersion?.version_id);

  const versions = await a.from('anamnesis_versions').select('id,version_number').eq('patient_id', seeded.patientId);
  expect(versions.error).toBeNull();
  expect(versions.data).toHaveLength(1);
  expect(versions.data?.[0]?.version_number).toBe(1);

  const bRead = await b.from('anamnesis_versions').select('id').eq('patient_id', seeded.patientId);
  expect(bRead.error).toBeNull();
  expect(bRead.data).toEqual([]);

  const bWrite = await b.rpc('save_anamnesis_draft_v2', {
    p_patient_id: seeded.patientId,
    p_expected_revision: 0,
    p_answers: answers,
    p_form_schema_version: 2,
  });
  expect(bWrite.error).not.toBeNull();
});
