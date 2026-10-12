import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { addMonthsClamped, shiftDate, suggestedContactMonths, weekMonday } from './contactCalendar';
describe('contact calendar date rules', () => {
  it('keeps each suggestion on its week and day', () => {
    expect(weekMonday('2026-10-18')).toBe('2026-10-12');
    expect(shiftDate('2026-10-12', 7)).toBe('2026-10-19');
  });
  it('clamps month length for follow-up suggestions', () => {
    expect(addMonthsClamped('2026-10-31', 4)).toBe('2027-02-28');
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29');
  });
  it('proposes months without enabling them', () => {
    expect(suggestedContactMonths('Toxina botulínica')).toBe(4);
    expect(suggestedContactMonths('Preenchimento')).toBe(6);
  });
});