const VERSION = '4.0.1';
const STATIC_CACHE = `hub-giulia-static-${VERSION}`;
const SHELL_CACHE = `hub-giulia-shell-${VERSION}`;
const SAFE_STATIC = ['/manifest.webmanifest','/icons/apple-touch-icon.png','/icons/icon-192.png','/icons/icon-512.png','/icons/icon-maskable-512.png'];
const SHELL_KEY = '/__hub_safe_shell__';
self.addEventListener('install',event=>{event.waitUntil(caches.open(STATIC_CACHE).then(cache=>cache.addAll(SAFE_STATIC)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('hub-giulia-')&&key!==STATIC_CACHE&&key!==SHELL_CACHE).map(key=>caches.delete(key)));await self.clients.claim();})());});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();if(event.data?.type==='PURGE_HUB_CACHES')event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('hub-giulia-')).map(key=>caches.delete(key)));})());});
async function networkFirstNavigation(request){try{const response=await fetch(request);if(response.ok&&response.type==='basic'){const cache=await caches.open(SHELL_CACHE);await cache.put(SHELL_KEY,response.clone());}return response;}catch(error){const cached=await caches.open(SHELL_CACHE).then(cache=>cache.match(SHELL_KEY));if(cached)return cached;throw error;}}
async function cacheFirstStatic(request){const cached=await caches.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok&&response.type==='basic'){const cache=await caches.open(STATIC_CACHE);await cache.put(request,response.clone());}return response;}
self.addEventListener('fetch',event=>{const request=event.request;if(request.method!=='GET')return;const url=new URL(request.url);if(url.origin!==self.location.origin)return;
  // Remote anamnesis signing is bearer-link clinical content: always network-only,
  // never write its navigation response to the reusable app shell cache.
  if(url.pathname.startsWith('/assinar/anamnese/')){event.respondWith(fetch(request,{cache:'no-store'}));return;}
  if(request.mode==='navigate'){event.respondWith(networkFirstNavigation(request));return;}
  if(SAFE_STATIC.includes(url.pathname)){event.respondWith(cacheFirstStatic(request));return;}
  const safeAsset=url.pathname.startsWith('/assets/')&&['script','style','font'].includes(request.destination);if(safeAsset)event.respondWith(cacheFirstStatic(request));
  // Everything else is intentionally network-only by omission: photos, PDFs,
  // API calls and authenticated/private clinical data are not persisted here.
});
