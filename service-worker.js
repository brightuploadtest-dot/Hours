const CACHE_NAME = 'client-hours-cache-v22'; // Bumped cache version to v22
const ASSETS = [
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon.svg'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        }).then(() => self.skipWaiting()) // Force the waiting service worker to become active
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('Removing old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Claim active clients immediately
    );
});

// Stale-While-Revalidate strategy for static assets, bypassing API routes completely
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Skip caching/interception for API requests and non-GET requests
    if (e.request.method !== 'GET' || url.pathname.includes('/api/')) {
        return; // Hand over execution back to native browser network engine
    }

    e.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            // Treat root path '/' and directory paths ending in '/' as './index.html' for cache matching
            const isRoot = url.pathname === '/' || url.pathname.endsWith('/');
            const cacheKey = isRoot ? './index.html' : e.request;

            return cache.match(cacheKey).then((cachedResponse) => {
                const fetchPromise = fetch(e.request)
                    .then((networkResponse) => {
                        if (networkResponse.status === 200) {
                            // Cache the exact request made
                            cache.put(e.request, networkResponse.clone());
                            
                            // If this was a root path request, also refresh the './index.html' cache entry
                            if (isRoot) {
                                cache.put('./index.html', networkResponse.clone());
                            }
                        }
                        return networkResponse;
                    })
                    .catch(() => {
                        // Suppress background validation errors when completely offline
                    });

                // Return instant cached response if available, fallback to network fetch
                return cachedResponse || fetchPromise;
            });
        })
    );
});

