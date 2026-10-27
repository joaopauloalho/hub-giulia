import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { signedInClient } from './helpers';

const payment = (amount: number) => [{
  method: 'pix', base_amount: amount, amount, card_brand: null, installments: 1,
  fee_pct: null, fee_value: null, net_amount: amount, absorve_taxa: true, scheduled_date: null,
}];

test('cancelamento seguro: financeiro, estoque, auditoria e isolamento', async () => {
  const owner = await signedInClient('a');
  const outsider = await signedInClient('b');
  const suffix = randomUUID();

  const patient = await owner.from('patients').insert({ name: 'CANCEL E2E ' + suffix }).select('id').single();
  expect(patient.error).toBeNull();
  const service = await owner.from('services').insert({
    name: 'CANCEL E2E Service ' + suffix, type: 'servico',
    price: 100, cost_per_unit: 10, cost_is_configured: true,
    active: true, is_injectable: false,
  }).select('id').single();
  expect(service.error).toBeNull();

  const material = await owner.rpc('create_material_v1', {
    p_idempotency_key: randomUUID(), p_name: 'CANCEL E2E Material ' + suffix,
    p_unit_label: 'un.', p_unit_cost: 2, p_initial_stock: 10, p_minimum_stock: 0, p_active: true,
  });
  expect(material.error).toBeNull();
  const materialId = (material.data as { id: string }).id;
  const created = await owner.rpc('create_procedure_v5', {
    p_idempotency_key: randomUUID(), p_patient_id: patient.data!.id,
    p_appointment_id: null, p_performed_at: new Date().toISOString(),
    p_items: [{ service_id: service.data!.id, qty: 1, final_price: 100 }],
    p_payment_entries: payment(100), p_injectable_maps: [], p_coverages: [],
    p_materials: [{ material_id: materialId, quantity: 2 }],
    p_clinical_minutes: 0, p_notes: 'Duplicado proposital de teste',
  });
  expect(created.error, created.error?.message).toBeNull();
  const id = (created.data as { id: string }).id;
  const getStock = async () => {
    const stock = await owner.from('materials').select('stock_quantity').eq('id', materialId).single();
    expect(stock.error).toBeNull();
    return Number(stock.data!.stock_quantity);
  };
  expect(await getStock()).toBe(8);

  const wrongUser = await outsider.rpc('cancel_procedure_v1', {
    p_procedure_id: id, p_expected_revision: 1, p_reason: 'Paciente incorreta',
  });
  expect(wrongUser.error).not.toBeNull();

  const outdated = await owner.rpc('cancel_procedure_v1', {
    p_procedure_id: id, p_expected_revision: 0, p_reason: 'Paciente incorreta',
  });
  expect(outdated.error?.message).toContain('ATTENDANCE_CANCEL_CONFLICT');
  expect(await getStock()).toBe(8);

  const cancelled = await owner.rpc('cancel_procedure_v1', {
    p_procedure_id: id, p_expected_revision: 1, p_reason: 'Paciente incorreta',
  });
  expect(cancelled.error, cancelled.error?.message).toBeNull();
  expect((cancelled.data as { deleted: boolean }).deleted).toBe(true);
  expect((await owner.from('procedures').select('id').eq('id', id)).data).toHaveLength(0);
  expect((await owner.from('procedure_payments').select('id').eq('procedure_id', id)).data).toHaveLength(0);
  expect(await getStock()).toBe(10);

  const audit = await owner.from('procedure_edit_events')
    .select('reason,before_snapshot,after_snapshot').eq('procedure_id_snapshot', id);
  expect(audit.error).toBeNull();
  expect(audit.data?.some(row => row.reason === 'Exclusao de atendimento: Paciente incorreta'
    && (row.after_snapshot as { deleted: boolean }).deleted)).toBe(true);

  const repeated = await owner.rpc('cancel_procedure_v1', {
    p_procedure_id: id, p_expected_revision: 1, p_reason: 'Paciente incorreta',
  });
  expect(repeated.error).not.toBeNull();
  expect(await getStock()).toBe(10);
});
