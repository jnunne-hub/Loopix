const CACHE_NAME = 'music-player-v1'; // Changez si vous modifiez les fichiers mis en cache
const urlsToCache = [
  './', // Cache la racine (souvent index.html)
  'index.html',
  'style.css',
  'script.js',
  'lib/jsmediatags.min.js', // Cache la librairie
  'placeholder.png',        // Cache l'image par défaut
  'manifest.json',          // Cache le manifest
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css', // Cache FontAwesome CSS
  // Note: Les polices FontAwesome sont chargées par le CSS ci-dessus, elles pourraient nécessiter une stratégie de cache plus avancée si le hors-ligne complet est critique.
];
const DB_NAME = 'MusicPlayerDB';
const DB_VERSION = 3; // DOIT correspondre à la version utilisée dans script.js
const STORE_NAME = 'tracks';

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installation...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Mise en cache des ressources de base');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('Service Worker: Installation terminée.');
        return self.skipWaiting(); // Force le nouveau SW à devenir actif immédiatement
      })
      .catch(error => {
          console.error('Service Worker: Erreur lors de la mise en cache initiale:', error);
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activation...');
  // Supprimer les anciens caches s'ils existent
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter(cacheName => cacheName !== CACHE_NAME)
                 .map(cacheName => caches.delete(cacheName))
      ).then(() => {
          console.log('Service Worker: Anciens caches supprimés.');
          return self.clients.claim(); // Permet au SW activé de contrôler les clients immédiatement
      });
    })
  );
});


self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Stratégie Cache d'abord, puis réseau pour les ressources statiques connues
  if (urlsToCache.includes(requestUrl.pathname) || requestUrl.origin === location.origin || requestUrl.origin === 'https://cdnjs.cloudflare.com') {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // console.log('SW: Ressource trouvée dans le cache:', requestUrl.pathname);
          return cachedResponse;
        }
        // console.log('SW: Ressource non trouvée dans le cache, fetch réseau:', requestUrl.pathname);
        return fetch(event.request).then(networkResponse => {
             // Optionnel: Mettre en cache la nouvelle ressource récupérée du réseau
             // if (networkResponse && networkResponse.status === 200) {
             //    caches.open(CACHE_NAME).then(cache => {
             //        cache.put(event.request, networkResponse.clone());
             //    });
             // }
            return networkResponse;
        }).catch(error => {
            console.error('SW: Erreur fetch réseau:', error);
            // Fournir une réponse de secours si nécessaire (ex: page hors ligne)
        });
      })
    );
  } else if (requestUrl.protocol === 'blob:') {
      // **AVERTISSEMENT:** Intercepter les URLs blob: ici est complexe et peut ne pas fonctionner de manière fiable
      // car l'URL blob peut être spécifique au contexte du document principal et expirer.
      // Il est généralement préférable que le script principal gère directement les blobs depuis IndexedDB.
      // Ce code est laissé à titre indicatif mais pourrait être retiré.
       console.log('SW: Tentative (expérimentale) de gestion de requête blob:', requestUrl.href);
       // On ne fait rien de spécial ici, on laisse le navigateur gérer les blobs.
       // Pour une vraie gestion offline des blobs via SW, il faudrait une approche différente
       // (ex: intercepter la requête audio normale et la servir depuis un blob stocké dans le Cache Storage API).
       return; // Laisse le navigateur gérer la requête blob normalement.

  } else {
    // Pour les autres requêtes (API externes non cachées, etc.), utiliser stratégie réseau d'abord.
    // console.log('SW: Requête réseau (non cachée):', requestUrl.href);
    event.respondWith(fetch(event.request).catch(error => {
        console.error('SW: Erreur fetch pour requête non cachée:', error);
        // Potentiellement retourner une réponse d'erreur ou de secours
    }));
  }
});


// --- Fonction utilitaire (potentiellement pour l'interception blob, mais non fiable ici) ---
// NOTE: Cette fonction est laissée à titre d'exemple mais N'EST PAS utilisée dans la logique fetch ci-dessus
// en raison des limitations liées aux URLs blob dans les SW.
async function getTrackBlobFromIndexedDB(blobUrl) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = (event) => reject("Erreur ouverture DB pour blob");
    request.onsuccess = (event) => {
      const db = event.target.result;
      try {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        // **Problème:** On ne peut pas chercher directement par URL blob.
        // Il faudrait trouver la piste par un ID persistant si on connaissait l'ID correspondant à l'URL blob.
        // Cette approche est fondamentalement limitée.
        // Pour l'exemple, on imagine qu'on pourrait récupérer toutes les pistes et trouver celle qui *pourrait* correspondre.
        const getAllRequest = store.getAll();
        getAllRequest.onsuccess = () => {
           const tracks = getAllRequest.result;
           // Logique de recherche (peu fiable) - NE PAS UTILISER EN PRODUCTION TEL QUEL
           console.warn("SW: Recherche de blob par URL non fiable.");
           // const foundTrack = tracks.find(t => /* une certaine logique pour lier blobUrl à t */ );
           // resolve(foundTrack ? foundTrack.blob : null);
           resolve(null); // Retourner null car la recherche n'est pas fiable
        };
        getAllRequest.onerror = () => reject("Erreur getAll pour blob");
        transaction.onerror = () => reject("Erreur transaction pour blob");
      } catch (e) {
          reject("Erreur transaction DB pour blob");
      }
    };
     request.onupgradeneeded = (event) => {
         // S'assurer que le schéma est à jour si on a ouvert une version différente ici
         // Normalement, la version devrait correspondre et onupgradeneeded ne devrait pas se déclencher ici
         // si script.js a déjà mis à jour.
         console.log("SW: onupgradeneeded déclenché lors de la tentative de lecture de blob.");
         // Il faudrait copier la logique de onupgradeneeded de script.js ici pour être sûr.
     };
  });
}
