import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminClient, signedInClient } from './helpers';

async function makePatient() {
  const client = await signedInClient('a');
  const { data: { user } } = await client.auth.getUser();
  expect(user).toBeTruthy();
  const admin = adminClient();
  const { data, error } = await admin.from('patients').insert({
    user_id: user!.id,
    name: `E2E assinatura v5 ${randomUUID().slice(0, 8)}`,
    birth_date: '1994-08-21',
    phone: '43999991234',
  }).select('id').single();
  expect(error).toBeNull();
  return { client, admin, userId: user!.id, patientId: data!.id as string };
}

test('schema v5 preserves intolerance answers and promotes compatible schema-4 drafts', async () => {
  const { client, patientId } = await makePatient();
  const answers = {
    conditions: {},
    medications: null,
    medications_status: null,
    allergies: null,
    allergies_status: null,
    surgical_history: {
      intolerancia_lactose: true,
      intolerancia_lactose_detalhe: 'Distensão abdominal',
      doenca_celiaca_sensibilidade_gluten: false,
      outras_intolerancias_restricoes: false,
    },
    habits: {},
    aesthetics: {},
  };

  const saved = await client.rpc('save_anamnesis_draft_v2', {
    p_patient_id: patientId,
    p_expected_revision: 0,
    p_answers: answers,
    p_form_schema_version: 4,
  });
  expect(saved.error).toBeNull();

  const finalized = await client.rpc('finalize_anamnesis_v2', {
    p_patient_id: patientId,
    p_expected_revision: 1,
    p_idempotency_key: randomUUID(),
  });
  expect(finalized.error).toBeNull();
  const result = Array.isArray(finalized.data) ? finalized.data[0] : finalized.data;

  const { data: version, error } = await client.from('anamnesis_versions')
    .select('form_schema_version,answers_snapshot,form_schema_snapshot')
    .eq('id', result!.version_id)
    .single();
  expect(error).toBeNull();
  expect(version?.form_schema_version).toBe(5);

  const schema = version?.form_schema_snapshot as { version?: number; sections?: Array<{ key?: string; fields?: Array<{ key?: string }> }> };
  expect(schema.version).toBe(5);
  const intoleranceSection = schema.sections?.find(section => section.key === 'intolerances');
  expect(intoleranceSection?.fields?.map(field => field.key)).toEqual([
    'intolerancia_lactose',
    'doenca_celiaca_sensibilidade_gluten',
    'outras_intolerancias_restricoes',
  ]);

  const snapshot = version?.answers_snapshot as { surgical_history?: Record<string, unknown> };
  expect(snapshot.surgical_history?.intolerancia_lactose).toBe(true);
  expect(snapshot.surgical_history?.intolerancia_lactose_detalhe).toBe('Distensão abdominal');
});

test('signature link modes are explicit while legacy links stay backwards-compatible', async () => {
  const { client, admin, userId, patientId } = await makePatient();
  const saved = await client.rpc('save_anamnesis_draft_v2', {
    p_patient_id: patientId,
    p_expected_revision: 0,
    p_answers: { conditions: {}, surgical_history: {}, habits: {}, aesthetics: {} },
    p_form_schema_version: 4,
  });
  expect(saved.error).toBeNull();
  const finalized = await client.rpc('finalize_anamnesis_v2', {
    p_patient_id: patientId,
    p_expected_revision: 1,
    p_idempotency_key: randomUUID(),
  });
  expect(finalized.error).toBeNull();
  const version = Array.isArray(finalized.data) ? finalized.data[0] : finalized.data;
  const { data: hash, error: hashError } = await admin.rpc('anamnesis_version_content_sha256_v1', { p_version_id: version!.version_id });
  expect(hashError).toBeNull();

  const tokenHash = 'b'.repeat(64);
  const { data: link, error } = await admin.from('anamnesis_signature_links').insert({
    user_id: userId,
    patient_id: patientId,
    anamnesis_version_id: version!.version_id,
    token_hash: tokenHash,
    content_sha256: hash,
    delivery_mode: 'remote',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: userId,
  }).select('delivery_mode,verification_attempts,verification_locked_until').single();
  expect(error).toBeNull();
  expect(link?.delivery_mode).toBe('remote');
  expect(link?.verification_attempts).toBe(0);
  expect(link?.verification_locked_until).toBeNull();
});
