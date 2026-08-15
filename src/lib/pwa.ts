import { hasDirtyForms } from './dirtyState';

export const HUB_SW_URL = '/sw.js';
export const HUB_PWA_UPDATE_EVENT = 'hub:pwa-update';
export const HUB_PWA_INSTALL_EVENT = 'hub:pwa-install-ready';

export type HubInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

declare global {
  interface Window {
    __hubInstallPrompt?: HubInstallPromptEvent | null;
    __hubServiceWorkerRegistration?: ServiceWorkerRegistration | null;
  }
}

let reloadForUpdate = false;

export function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false;
  const navigatorStandalone = 'standalone' in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return window.matchMedia('(display-mode: standalone)').matches || navigatorStandalone;
}

export function isIosFamily() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function canApplyPwaUpdate() {
  return !hasDirtyForms();
}

export async function applyWaitingServiceWorker(registration?: ServiceWorkerRegistration | null) {
  if (typeof window === 'undefined') return false;
  const activeRegistration = registration ?? window.__hubServiceWorkerRegistration;
  if (!activeRegistration?.waiting || !canApplyPwaUpdate()) return false;
  reloadForUpdate = true;
  activeRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export async function promptHubInstall() {
  if (typeof window === 'undefined') return null;
  const event = window.__hubInstallPrompt;
  if (!event) return null;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') window.__hubInstallPrompt = null;
  return choice;
}

export async function purgeHubCaches() {
  if (typeof window === 'undefined') return;
  try {
    window.__hubServiceWorkerRegistration?.active?.postMessage({ type: 'PURGE_HUB_CACHES' });
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('hub-giulia-')).map(key => caches.delete(key)));
    }
  } catch (error) {
    console.warn('[pwa:purge]', error);
  }
}

export function registerHubPwa() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    window.__hubInstallPrompt = event as HubInstallPromptEvent;
    window.dispatchEvent(new Event(HUB_PWA_INSTALL_EVENT));
  });

  window.addEventListener('appinstalled', () => {
    window.__hubInstallPrompt = null;
    window.dispatchEvent(new Event(HUB_PWA_INSTALL_EVENT));
  });

  if (!('serviceWorker' in navigator)) return;

  const installRegistration = async () => {
    try {
      const registration = await navigator.serviceWorker.register(HUB_SW_URL, { scope: '/' });
      window.__hubServiceWorkerRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) window.dispatchEvent(new Event(HUB_PWA_UPDATE_EVENT));
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) window.dispatchEvent(new Event(HUB_PWA_UPDATE_EVENT));
        });
      });
      void registration.update().catch(() => undefined);
    } catch (error) {
      console.warn('[pwa:register]', error);
    }
  };

  if (document.readyState === 'complete') void installRegistration();
  else window.addEventListener('load', () => { void installRegistration(); }, { once: true });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadForUpdate) return;
    reloadForUpdate = false;
    window.location.reload();
  });
}
