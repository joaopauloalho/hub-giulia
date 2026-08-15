type DirtyListener = () => void;

const dirtySources = new Set<string>();
const listeners = new Set<DirtyListener>();

function emit() {
  listeners.forEach(listener => listener());
}

export function setDirtySource(key: string, dirty: boolean) {
  const had = dirtySources.has(key);
  if (dirty) dirtySources.add(key);
  else dirtySources.delete(key);
  if (had !== dirty) emit();
}

export function clearDirtySource(key: string) {
  setDirtySource(key, false);
}

export function clearAllDirtySources() {
  if (!dirtySources.size) return;
  dirtySources.clear();
  emit();
}

export function hasDirtyForms() {
  return dirtySources.size > 0;
}

export function subscribeDirtyState(listener: DirtyListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const DIRTY_NAVIGATION_MESSAGE = 'Existem alterações que ainda não foram salvas. Deseja sair mesmo assim?';

export function confirmDirtyNavigation() {
  if (!hasDirtyForms()) return true;
  if (typeof window === 'undefined') return false;
  return window.confirm(DIRTY_NAVIGATION_MESSAGE);
}
