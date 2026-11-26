// GUMMI · service worker: solo recibe avisos y los muestra (no guarda nada en caché,
// así la web siempre se carga actualizada).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { titulo: 'Gummi', cuerpo: e.data ? e.data.text() : '' } }
  const url = new URL('./', self.registration.scope)
  if (d.destino) url.searchParams.set('ir', d.destino)
  if (d.ref) url.searchParams.set('ref', String(d.ref))
  if (d.id) url.searchParams.set('aviso', String(d.id))
  const tareas = [
    self.registration.showNotification(d.titulo || 'Gummi', {
      body: d.cuerpo || '',
      icon: './icono-192.png?v=2',
      badge: './badge.png',
      tag: 'gummi-' + (d.id || Date.now()),
      data: { url: url.href },
    }),
  ]
  if (self.navigator && self.navigator.setAppBadge) tareas.push(self.navigator.setAppBadge(d.sinLeer || 1).catch(() => {}))
  e.waitUntil(Promise.all(tareas))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          c.postMessage({ tipo: 'abrir', url })
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
