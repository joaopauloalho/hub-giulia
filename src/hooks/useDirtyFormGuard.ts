import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { DIRTY_NAVIGATION_MESSAGE, setDirtySource } from '../lib/dirtyState';

export function useDirtyFormGuard(key: string, dirty: boolean) {
  useEffect(() => {
    setDirtySource(key, dirty);
    return () => setDirtySource(key, false);
  }, [dirty, key]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(DIRTY_NAVIGATION_MESSAGE)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);

  return blocker;
}
