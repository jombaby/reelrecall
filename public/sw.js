<<<<<<< ours
const CACHE="reelreplay-icons-20260903",SHELL=["/manifest.webmanifest","/icons/reelrecall.svg","/icons/reelrecall-maskable.svg"];
=======
const CACHE="reelrecall-pwa-v7",SHELL=["/manifest.webmanifest","/icons/reelrecall.svg","/icons/reelrecall-maskable.svg"];
>>>>>>> theirs
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener("fetch",event=>{const request=event.request,url=new URL(request.url);if(request.method!=="GET"||url.origin!==self.location.origin||url.pathname.startsWith("/api/")||request.mode==="navigate")return;if(url.pathname.startsWith("/_next/static/")||url.pathname.startsWith("/icons/")){event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));return response})))}});
