// ═══════════════════════════════════════════════════════════════
// sw-haccp.js — Service Worker FrigoCheck
// ───────────────────────────────────────────────────────────────
// Invia una notifica push l'ULTIMO GIORNO del mese alle 9:00,
// anche se l'app è chiusa o il telefono è bloccato.
//
// Funzionamento:
// 1. L'app (app.js) registra questo SW e gli manda via postMessage
//    il timestamp dell'ultimo giorno del mese corrente (ore 9:00).
// 2. Il SW salva il timestamp in IndexedDB (no localStorage nel SW).
// 3. Un alarm loop (setInterval ogni minuto) controlla se è l'ora
//    giusta e spara la notifica.
// 4. Quando l'utente tocca la notifica, apre l'app.
// ═══════════════════════════════════════════════════════════════

const SW_VERSION = 'haccp-sw-v2';
const DB_NAME    = 'haccp-sw-db';
const STORE_NAME = 'alarms';

// ── Apri/crea IndexedDB ────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, value });
    tx.oncomplete = () => res();
    tx.onerror    = e => rej(e.target.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = e => res(e.target.result ? e.target.result.value : null);
    req.onerror   = e => rej(e.target.error);
  });
}

// ── Installa e attiva immediatamente ──────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

// ── Riceve messaggi dall'app ───────────────────────────────────
self.addEventListener('message', async event => {
  const { type, timestamp, mese } = event.data || {};

  if (type === 'SCHEDULE_NOTIFICA_MENSILE') {
    // Salva il timestamp programmato e l'etichetta del mese
    await dbSet('alarm_timestamp', timestamp);
    await dbSet('alarm_mese', mese);
    await dbSet('alarm_fired', false);
    console.log('[SW FrigoCheck] Notifica mensile programmata per:', new Date(timestamp).toLocaleString('it-IT'));
  }

  if (type === 'CANCEL_NOTIFICA_MENSILE') {
    // Cancella qualsiasi notifica mensile precedentemente programmata
    await dbSet('alarm_timestamp', 0);
    await dbSet('alarm_mese', '');
    await dbSet('alarm_fired', true);
    console.log('[SW FrigoCheck] Notifica mensile cancellata');
  }

  if (type === 'PING') {
    event.source && event.source.postMessage({ type: 'PONG' });
  }
});

// ── Controlla ogni minuto se è il momento di notificare ───────
// Usiamo un periodicsync se disponibile, altrimenti un interval
// che parte quando il SW è sveglio (almeno all'apertura dell'app).
// Per notifiche mentre l'app è chiusa usiamo il Periodic Background Sync
// API (richiede registrazione esplicita dall'app) o, come fallback,
// l'alarm viene controllato ad ogni "fetch" event intercettato.

async function checkAlarm() {
  const timestamp = await dbGet('alarm_timestamp');
  const fired     = await dbGet('alarm_fired');
  if (!timestamp || fired) return;

  const now = Date.now();
  // Finestra: da ora programmata fino a 4 ore dopo (in caso il SW
  // si svegli tardi — es. se il telefono era spento)
  if (now >= timestamp && now <= timestamp + 4 * 3600 * 1000) {
    const mese = (await dbGet('alarm_mese')) || 'questo mese';
    await dbSet('alarm_fired', true);
    await self.registration.showNotification('📋 FrigoCheck — Registro mensile', {
      body: `Oggi è l'ultimo giorno di ${mese}. Domani l'app sarà bloccata: scarica il registro e fallo firmare al responsabile.`,
      icon: '/haccp.png',
      badge: '/haccp.png',
      tag: 'haccp-mensile',
      requireInteraction: true,   // non sparisce automaticamente
      actions: [
        { action: 'apri', title: '📥 Apri app e scarica' },
        { action: 'ignora', title: 'Dopo' }
      ],
      data: { url: self.registration.scope }
    });
  }
}

// Controlla all'attivazione del SW (utente apre l'app o background sync)
self.addEventListener('activate', () => { checkAlarm(); });

// Periodic Background Sync (Chrome Android, se autorizzato)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'haccp-alarm-check') {
    event.waitUntil(checkAlarm());
  }
});

// Fallback: controlla ad ogni fetch (intercetta tutte le richieste dell'app)
self.addEventListener('fetch', event => {
  // Esegui check senza bloccare il fetch
  checkAlarm();
  // Passa la richiesta normalmente (no cache intercepting)
  return;
});

// ── Tocco sulla notifica ───────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'ignora') return;

  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Se l'app è già aperta, la porta in primo piano
      for (const client of clients) {
        if (client.url.startsWith(url)) {
          return client.focus();
        }
      }
      // Altrimenti apre una nuova finestra
      return self.clients.openWindow(url);
    })
  );
});
