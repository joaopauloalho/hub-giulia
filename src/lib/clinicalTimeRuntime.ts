const STORAGE_KEY = 'hub-giulia:attendance-clinical-minutes';

let memoryMinutes = 0;

function normalizeMinutes(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1440, Math.round(value)));
}

export function getClinicalMinutes() {
  if (typeof window === 'undefined') return memoryMinutes;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored !== null) memoryMinutes = normalizeMinutes(Number(stored));
  } catch {
    // sessionStorage can be unavailable in restrictive browser modes.
  }
  return memoryMinutes;
}

export function setClinicalMinutes(value: number) {
  memoryMinutes = normalizeMinutes(value);
  if (typeof window === 'undefined') return memoryMinutes;
  try { window.sessionStorage.setItem(STORAGE_KEY, String(memoryMinutes)); } catch { /* noop */ }
  return memoryMinutes;
}

export function clearClinicalMinutes() {
  memoryMinutes = 0;
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
