import { describe, expect, it } from 'vitest';
import { relationshipCreditSummary, relationshipDate, relationshipPersonStateKey, sortRelationshipOpportunities, type RelationshipOpportunity } from './relationship';

const opportunity = (key: string, type: RelationshipOpportunity['type'], priority_class: string): RelationshipOpportunity => ({
  key,
  type,
  priority_class,
  source_type: type === 'return' ? 'procedure_return' : type === 'proposal' ? 'proposal_version' : type === 'credit' ? 'package' : 'relationship_patient',
  source_id: key,
  status: 'open',
  label: key,
  due_date: null,
  age_days: null,
  amount: null,
  remaining: null,
  expires_on: null,
  route: '/',
  communication_item_key: key,
  template_key: type === 'return' ? 'procedure_return' : type === 'proposal' ? 'proposal_followup' : type === 'credit' ? 'package_expiry' : 'relationship_reactivation',
  context: {},
});

describe('relationship helpers', () => {
  it('keeps canonical patient/contact identities separate', () => {
    expect(relationshipPersonStateKey('patient', 'same-name')).toBe('relationship:patient:same-name');
    expect(relationshipPersonStateKey('contact', 'same-name')).toBe('relationship:contact:same-name');
    expect(relationshipPersonStateKey('patient', 'same-name')).not.toBe(relationshipPersonStateKey('contact', 'same-name'));
  });

  it('never sums heterogeneous credit units', () => {
    expect(relationshipCreditSummary([
      { package_item_id: 'a', service_name: 'Sessão', balance: 2, unit_label: 'sessões' },
      { package_item_id: 'b', service_name: 'Produto', balance: 15, unit_label: 'unidades' },
    ])).toBe('2 sessões + 15 unidades');
  });

  it('orders factual urgency without financial scoring', () => {
    const sorted = sortRelationshipOpportunities([
      opportunity('reactivation', 'reactivation', 'reactivation'),
      opportunity('proposal', 'proposal', 'proposal_followup'),
      opportunity('credit', 'credit', 'credit_expiry'),
      opportunity('return', 'return', 'return_overdue'),
    ]);
    expect(sorted.map(item => item.key)).toEqual(['return', 'credit', 'proposal', 'reactivation']);
  });

  it('formats clinical dates in Sao Paulo without UTC day drift', () => {
    expect(relationshipDate('2026-08-20')).toBe('20/08/2026');
    expect(relationshipDate('2026-08-20T01:00:00.000Z')).toBe('19/08/2026');
  });
});
