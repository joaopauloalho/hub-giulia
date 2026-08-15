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

export async function applyWaitingServiceWorker(registration = window.__hubServiceWorkerRegistration) {
  if (!registration?.waiting) return false;
  if (!canApplyPwaUpdate()) return false;
  reloadForUpdate = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export async function promptHubInstall() {
  const event = window.__hubInstallPrompt;
  if (!event) return null;
  await event.prompt();
  const choice = await event.userChoice;
  if (choice.outcome === 'accepted') window.__hubInstallPrompt = null;
  return choice;
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

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(HUB_SW_URL, { scope: '/' }).then(registration => {
      window.__hubServiceWorkerRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) {
        window.dispatchEvent(new Event(HUB_PWA_UPDATE_EVENT));
      }
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new Event(HUB_PWA_UPDATE_EVENT));
          }
        });
      });
    }).catch(error => console.warn('[pwa:register]', error));
  }, { once: true });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadForUpdate) return;
    reloadForUpdate = false;
    window.location.reload();
  });
}
