// OpenThings service worker: shows reminder notifications and focuses the app when one is clicked.
// No caching yet — the app is always loaded fresh from the server.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const taskId = event.notification.data && event.notification.data.taskId;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows[0];
      if (client) {
        await client.focus();
        if (taskId) client.postMessage({ type: 'openthings:open-task', taskId });
        return;
      }
      const root = self.registration.scope; // works under a sub-path too
      await self.clients.openWindow(taskId ? `${root}?task=${encodeURIComponent(taskId)}` : root);
    })(),
  );
});

// Server push (planned): the sync server will send reminders with Web Push so they arrive
// while the app is closed. Payload: { title, body, taskId }.
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'OpenThings', {
      body: data.body || '',
      tag: data.taskId ? `reminder-${data.taskId}` : undefined,
      data: { taskId: data.taskId },
      icon: 'icon-192.png',
      badge: 'icon-192.png',
    }),
  );
});
