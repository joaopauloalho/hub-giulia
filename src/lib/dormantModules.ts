export const DORMANT_MODULES = ['internalAgenda', 'contracts', 'communication', 'waitlist', 'aftercare'] as const;
export type DormantModule = typeof DORMANT_MODULES[number];

/** Set to "1" in the browser, then reload, to show the unused modules again. */
export const DORMANT_MODULES_STORAGE_KEY = 'hub.showDormantModules';

export function dormantModulesEnabled(): boolean {
  if (import.meta.env.VITE_SHOW_DORMANT_MODULES === 'true') return true;
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(DORMANT_MODULES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
