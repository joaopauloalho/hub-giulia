import { useEffect, useState } from 'react';

export function useNetworkStatus() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    const onOnline = () => {
      setOnline(true);
      setRestored(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setRestored(false), 3500);
    };
    const onOffline = () => {
      setOnline(false);
      setRestored(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return { online, restored };
}
