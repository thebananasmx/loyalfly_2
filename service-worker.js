const CACHE_NAME = 'loyalfly-cache-v2'; // Versión de caché actualizada
const urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    './images/icon-192x192.png',
    './images/icon-512x512.png'
];

// Evento de instalación: guarda en caché el esqueleto de la aplicación.
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache abierto y guardando el app shell');
                return cache.addAll(urlsToCache);
            })
    );
});

// Evento de activación: limpia cachés antiguas.
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Si el nombre del caché no es el actual, se elimina.
                    if (cacheName !== CACHE_NAME) {
                        console.log('Eliminando caché antigua:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Evento de fetch: sirve contenido desde el caché primero (Cache First).
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Si la respuesta está en el caché, la retorna.
                if (response) {
                    return response;
                }
                // Si no, la busca en la red.
                return fetch(event.request);
            })
    );
});
