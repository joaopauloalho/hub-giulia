export type HubSearchResultType = 'patient' | 'lead' | 'contact';

export interface HubSearchResult {
  result_type: HubSearchResultType;
  result_id: string;
  name: string;
  subtitle: string;
  route: string;
  phone: string | null;
  score: number;
}

export const MAX_GLOBAL_SEARCH_QUERY = 80;
export const MIN_GLOBAL_SEARCH_QUERY = 2;

export function normalizeGlobalSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, MAX_GLOBAL_SEARCH_QUERY);
}

export function shouldRunGlobalSearch(value: string) {
  return normalizeGlobalSearchQuery(value).length >= MIN_GLOBAL_SEARCH_QUERY;
}

export function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function globalSearchTypeLabel(type: HubSearchResultType) {
  if (type === 'patient') return 'Paciente';
  if (type === 'lead') return 'Lead';
  return 'Contato';
}
