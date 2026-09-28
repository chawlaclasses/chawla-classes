// public/student/sw.js
const CACHE_NAME = 'chawla-classes-v2';
const DATA_CACHE_NAME = 'chawla-data-v2';
const OFFLINE_URL = '/student/offline.html';

// Assets to cache on install
const STATIC_ASSETS = [
  '/student/',
  '/student/index.html',
  '/student/offline.html',
  '/student/css/variables.css',
  '/student/css/base.css',
  '/student/css/layout.css',
  '/student/css/components.css',
  '/student/css/dashboard.css',
  '/student/css/practice.css',
  '/student/css/profile.css',
  '/student/css/notifications.css',
  '/student/css/responsive.css',
  '/student/js/app.js',
  '/student/js/router.js',
  '/student/js/api/client.js',
  '/student/js/api/auth.js',
  '/student/js/api/student.js',
  '/student/js/api/tests.js',
  '/student/js/api/results.js',
  '/student/js/api/practice.js',
  '/student/js/api/bookmarks.js',
  '/student/js/api/notifications.js',
  '/student/js/api/ai.js',
  '/student/js/services/auth.js',
  '/student/js/services/storage.js',
  '/student/js/services/theme.js',
  '/student/js/services/language.js',
  '/student/js/services/websocket.js',
  '/student/js/services/offline.js',
  '/student/js/components/Dashboard/index.js',
  '/student/js/components/Dashboard/Welcome.js',
  '/student/js/components/Dashboard/Stats.js',
  '/student/js/components/Dashboard/Charts.js',
  '/student/js/components/Dashboard/QuickActions.js',
  '/student/js/components/Dashboard/UpcomingTests.js',
  '/student/js/components/Dashboard/Leaderboard.js',
  '/student/js/components/Dashboard/Calendar.js',
  '/student/js/components/Dashboard/Activity.js',
  '/student/js/components/Dashboard/DailyTarget.js',
  '/student/js/components/Dashboard/AISuggestions.js',
  '/student/js/components/Dashboard/ProfileCompletion.js',
  '/student/manifest.json',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
  '/assets/icons/favicon-32x32.png',
  '/assets/icons/favicon-16x16.png'
];

// ─── Install Event ──────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(CACHE_NAME).then((cache) => {
        console.log('[SW] Caching static assets...');
        return cache.addAll(STATIC_ASSETS);
      }),
      // Skip waiting to activate immediately
      self.skipWaiting()
    ])
  );
});

// ─── Activate Event ─────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== DATA_CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      }),
      // Claim clients
      self.clients.claim()
    ])
  );
});

// ─── Fetch Event ────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }

  // Skip API requests - handle separately
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleAPIRequest(request));
    return;
  }

  // Skip WebSocket
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    event.respondWith(fetch(request));
    return;
  }

  // Handle static assets
  if (url.pathname.startsWith('/assets/') || 
      url.pathname.startsWith('/student/css/') ||
      url.pathname.startsWith('/student/js/')) {
    event.respondWith(handleStaticRequest(request));
    return;
  }

  // Handle HTML pages
  if (url.pathname === '/student/' || 
      url.pathname === '/student/index.html' ||
      url.pathname === '/student/offline.html') {
    event.respondWith(handleHTMLRequest(request));
    return;
  }

  // Default: Network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful responses
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

// ─── Handle API Requests ────────────────────────────────────────────────────
async function handleAPIRequest(request) {
  try {
    const response = await fetch(request);
    
    // Cache GET requests
    if (request.method === 'GET' && response.status === 200) {
      const clone = response.clone();
      const cache = await caches.open(DATA_CACHE_NAME);
      cache.put(request, clone);
    }
    
    return response;
  } catch (error) {
    // Try to return cached response
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    
    // Return offline response for API
    return new Response(JSON.stringify({
      success: false,
      error: 'You are offline. Please check your connection.',
      offline: true
    }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

// ─── Handle Static Requests ─────────────────────────────────────────────────
async function handleStaticRequest(request) {
  // Cache first, then network
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.status === 200) {
      const clone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, clone);
    }
    return response;
  } catch (error) {
    // Return offline page for HTML
    if (request.headers.get('accept').includes('text/html')) {
      return caches.match(OFFLINE_URL);
    }
    // Return fallback for assets
    return new Response('Asset not available offline', {
      status: 404,
      statusText: 'Not Found'
    });
  }
}

// ─── Handle HTML Requests ──────────────────────────────────────────────────
async function handleHTMLRequest(request) {
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      const clone = response.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, clone);
    }
    return response;
  } catch (error) {
    return caches.match(OFFLINE_URL);
  }
}

// ─── Background Sync ────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(syncData());
  }
});

async function syncData() {
  try {
    const cache = await caches.open('pending-actions');
    const requests = await cache.keys();
    
    const results = await Promise.allSettled(
      requests.map(async (request) => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.delete(request);
            return { success: true, url: request.url };
          }
          return { success: false, url: request.url };
        } catch (error) {
          return { success: false, url: request.url, error };
        }
      })
    );
    
    // Notify clients about sync results
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        results
      });
    });
    
    return results;
  } catch (error) {
    console.error('[SW] Sync error:', error);
  }
}

// ─── Push Notifications ────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  
  try {
    data = event.data.json();
  } catch {
    data = {
      title: 'Chawla Classes',
      body: 'You have a new notification',
      icon: '/assets/icons/icon-192x192.png',
      badge: '/assets/icons/badge-72x72.png'
    };
  }

  const options = {
    body: data.body || 'You have a new notification',
    icon: data.icon || '/assets/icons/icon-192x192.png',
    badge: data.badge || '/assets/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/student/',
      notificationId: data.id || Date.now()
    },
    actions: [
      { action: 'view', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    tag: data.tag || 'notification',
    renotify: true,
    requireInteraction: data.important || false,
    silent: data.silent || false
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Chawla Classes', options)
  );
});

// ─── Notification Click ────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const url = event.notification.data?.url || '/student/';
  
  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clients) => {
      // Check if there's already a window/tab open
      for (const client of clients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// ─── Message Handling ──────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const data = event.data;

  switch (data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME);
      caches.delete(DATA_CACHE_NAME);
      break;
      
    case 'GET_CACHE_SIZE':
      // Calculate cache size
      event.ports[0].postMessage({
        type: 'CACHE_SIZE',
        size: 'Calculating...'
      });
      break;
  }
});

// ─── Periodic Background Sync ─────────────────────────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update-cache') {
    event.waitUntil(updateCache());
  }
});

async function updateCache() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const requests = STATIC_ASSETS.map(url => new Request(url));
    
    await Promise.all(
      requests.map(async (request) => {
        try {
          const response = await fetch(request);
          if (response.status === 200) {
            cache.put(request, response);
          }
        } catch (error) {
          console.error('[SW] Update cache error:', request.url, error);
        }
      })
    );
    
    console.log('[SW] Cache updated');
  } catch (error) {
    console.error('[SW] Update cache error:', error);
  }
}

// ─── Logging ────────────────────────────────────────────────────────────────
console.log('[SW] Service Worker loaded successfully');