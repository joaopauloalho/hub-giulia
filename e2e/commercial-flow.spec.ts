import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

type E2EState = {
  dealId: string;
  serviceId: string;
  patientId: string;
};
const readState = async () => JSON.parse(await fs.readFile('.e2e-state.json', 'utf8')) as E2EState;

test('CRM deal flows through proposal to active package/credit without cross-tenant leakage', async () => {
  const seeded = await readState();
  const a = await signedInClient('a');
  const b = await signedInClient('b');

  const createKey = randomUUID();
  const [created1, created2] = await Promise.all([
    a.rpc('create_treatment_proposal_v1', {
      p_deal_id: seeded.dealId,
      p_title: 'E2E TEST Treatment Plan',
      p_idempotency_key: createKey,
    }),
    a.rpc('create_treatment_proposal_v1', {
      p_deal_id: seeded.dealId,
      p_title: 'E2E TEST Treatment Plan',
      p_idempotency_key: createKey,
    }),
  ]);
  expect(created1.error).toBeNull();
  expect(created2.error).toBeNull();
  const createdRow1 = Array.isArray(created1.data) ? created1.data[0] : created1.data;
  const createdRow2 = Array.isArray(created2.data) ? created2.data[0] : created2.data;
  expect(createdRow1?.proposal_id).toBeTruthy();
  expect(createdRow2?.proposal_id).toBe(createdRow1?.proposal_id);
  expect(createdRow2?.version_id).toBe(createdRow1?.version_id);
  const proposalId = createdRow1!.proposal_id as string;
  const versionId = createdRow1!.version_id as string;

  const saved = await a.rpc('save_treatment_proposal_draft_v1', {
    p_version_id: versionId,
    p_expected_revision: 0,
    p_title: 'E2E TEST Treatment Plan',
    p_valid_until: '2030-12-31',
    p_payment_terms: 'E2E TEST payment terms',
    p_internal_note: 'E2E TEST internal note',
    p_customer_note: 'E2E TEST customer note',
    p_discount_type: 'none',
    p_discount_value: 0,
    p_items: [{
      service_id: seeded.serviceId,
      service_name_snapshot: 'E2E TEST Service',
      description_snapshot: 'E2E TEST plan item',
      interval_note: null,
      quantity: 2,
      unit_label: 'sessão',
      list_unit_price_snapshot: 100,
      offered_unit_price: 100,
      discount_type: 'none',
      discount_value: 0,
      sort_order: 0,
    }],
  });
  expect(saved.error).toBeNull();
  const savedRow = Array.isArray(saved.data) ? saved.data[0] : saved.data;
  expect(savedRow?.draft_revision).toBe(1);
  expect(Number(savedRow?.total_value)).toBe(200);

  const issueKey = randomUUID();
  const [issued1, issued2] = await Promise.all([
    a.rpc('issue_treatment_proposal_v1', {
      p_version_id: versionId,
      p_expected_revision: 1,
      p_idempotency_key: issueKey,
    }),
    a.rpc('issue_treatment_proposal_v1', {
      p_version_id: versionId,
      p_expected_revision: 1,
      p_idempotency_key: issueKey,
    }),
  ]);
  expect(issued1.error).toBeNull();
  expect(issued2.error).toBeNull();
  const issuedRow1 = Array.isArray(issued1.data) ? issued1.data[0] : issued1.data;
  const issuedRow2 = Array.isArray(issued2.data) ? issued2.data[0] : issued2.data;
  expect(issuedRow1?.status).toBe('issued');
  expect(issuedRow2?.version_id).toBe(versionId);

  const acceptKey = randomUUID();
  const [accepted1, accepted2] = await Promise.all([
    a.rpc('accept_treatment_proposal_v1', {
      p_version_id: versionId,
      p_mark_deal_won: true,
      p_idempotency_key: acceptKey,
    }),
    a.rpc('accept_treatment_proposal_v1', {
      p_version_id: versionId,
      p_mark_deal_won: true,
      p_idempotency_key: acceptKey,
    }),
  ]);
  expect(accepted1.error).toBeNull();
  expect(accepted2.error).toBeNull();
  const acceptedRow = Array.isArray(accepted1.data) ? accepted1.data[0] : accepted1.data;
  expect(acceptedRow?.status).toBe('accepted');
  expect(acceptedRow?.deal_stage).toBe('won');

  const packageKey = randomUUID();
  const [package1, package2] = await Promise.all([
    a.rpc('create_package_from_proposal_v1', {
      p_proposal_version_id: versionId,
      p_idempotency_key: packageKey,
      p_valid_from: '2030-01-15',
      p_valid_until: '2030-12-31',
      p_notes: 'E2E TEST package',
    }),
    a.rpc('create_package_from_proposal_v1', {
      p_proposal_version_id: versionId,
      p_idempotency_key: packageKey,
      p_valid_from: '2030-01-15',
      p_valid_until: '2030-12-31',
      p_notes: 'E2E TEST package',
    }),
  ]);
  expect(package1.error).toBeNull();
  expect(package2.error).toBeNull();
  const packageRow1 = Array.isArray(package1.data) ? package1.data[0] : package1.data;
  const packageRow2 = Array.isArray(package2.data) ? package2.data[0] : package2.data;
  expect(packageRow1?.id).toBeTruthy();
  expect(packageRow2?.id).toBe(packageRow1?.id);
  const packageId = packageRow1!.id as string;

  const activationKey = randomUUID();
  const [active1, active2] = await Promise.all([
    a.rpc('activate_package_v1', { p_package_id: packageId, p_idempotency_key: activationKey }),
    a.rpc('activate_package_v1', { p_package_id: packageId, p_idempotency_key: activationKey }),
  ]);
  expect(active1.error).toBeNull();
  expect(active2.error).toBeNull();
  const activeRow = Array.isArray(active1.data) ? active1.data[0] : active1.data;
  expect(activeRow?.status).toBe('active');

  const proposalRows = await a.from('treatment_proposals').select('id').eq('id', proposalId);
  expect(proposalRows.error).toBeNull();
  expect(proposalRows.data).toHaveLength(1);

  const packageRows = await a.from('patient_packages').select('id,status,patient_id').eq('id', packageId);
  expect(packageRows.error).toBeNull();
  expect(packageRows.data).toHaveLength(1);
  expect(packageRows.data?.[0]?.patient_id).toBe(seeded.patientId);

  const packageItems = await a.from('patient_package_items').select('id,quantity_granted').eq('package_id', packageId);
  expect(packageItems.error).toBeNull();
  expect(packageItems.data).toHaveLength(1);
  expect(Number(packageItems.data?.[0]?.quantity_granted)).toBe(2);

  const ledger = await a.from('patient_credit_ledger').select('id,movement_type,quantity_delta').eq('package_id', packageId);
  expect(ledger.error).toBeNull();
  expect(ledger.data).toHaveLength(1);
  expect(ledger.data?.[0]?.movement_type).toBe('grant');
  expect(Number(ledger.data?.[0]?.quantity_delta)).toBe(2);

  for (const query of [
    b.from('treatment_proposals').select('id').eq('id', proposalId),
    b.from('treatment_proposal_versions').select('id').eq('id', versionId),
    b.from('patient_packages').select('id').eq('id', packageId),
    b.from('patient_package_items').select('id').eq('package_id', packageId),
    b.from('patient_credit_ledger').select('id').eq('package_id', packageId),
  ]) {
    const result = await query;
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  }
});
