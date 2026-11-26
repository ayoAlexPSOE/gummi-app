// GUMMI · Función "enviar-push"
// La base de datos la llama cada vez que se crean avisos nuevos y esta función
// los manda a los móviles de cada jugador (aunque tengan la app cerrada).
//
// Secretos que necesita (Supabase > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  -> las claves que te pasó Claude
//   (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya los pone Supabase solos)
// Importante: en los ajustes de la función, desactiva "Verify JWT".
// La seguridad la pone el secreto que guarda la base de datos.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const clave = Deno.env.get('GUMMI_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(Deno.env.get('SUPABASE_URL')!, clave, { auth: { persistSession: false } })

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:avisos@gummi.app',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')

  // Solo la base de datos conoce el secreto
  const { data: cfg, error: e1 } = await sb.from('push_config').select('secreto').eq('id', true).single()
  if (e1 || !cfg) return new Response('Sin configuración: ' + (e1?.message ?? ''), { status: 500 })
  if (req.headers.get('x-gummi-secreto') !== cfg.secreto) return new Response('No autorizado', { status: 401 })

  const { ids } = await req.json().catch(() => ({ ids: [] }))
  if (!Array.isArray(ids) || ids.length === 0) return Response.json({ enviados: 0 })

  const { data: avisos } = await sb.from('notificaciones')
    .select('id, usuario_id, titulo, cuerpo, destino, ref').in('id', ids)
  if (!avisos?.length) return Response.json({ enviados: 0 })

  const usuarios = [...new Set(avisos.map((a) => a.usuario_id))]
  const [{ data: subs }, { data: pendientes }] = await Promise.all([
    sb.from('suscripciones_push').select('*').in('usuario_id', usuarios),
    sb.from('notificaciones').select('usuario_id').in('usuario_id', usuarios).eq('leida', false),
  ])
  // Número de avisos sin leer de cada uno (para el globito del icono)
  const sinLeer: Record<string, number> = {}
  for (const p of pendientes ?? []) sinLeer[p.usuario_id] = (sinLeer[p.usuario_id] ?? 0) + 1

  let enviados = 0
  let caducados = 0
  const tareas: Promise<void>[] = []
  for (const a of avisos) {
    for (const s of (subs ?? []).filter((x) => x.usuario_id === a.usuario_id)) {
      const datos = JSON.stringify({
        id: a.id, titulo: a.titulo, cuerpo: a.cuerpo ?? '', destino: a.destino, ref: a.ref,
        sinLeer: sinLeer[a.usuario_id] ?? 1,
      })
      tareas.push(
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, datos, { TTL: 60 * 60 * 24, urgency: 'high' })
          .then(() => { enviados++ })
          .catch(async (err: any) => {
            // 404/410: el móvil ya no acepta avisos (app borrada, permiso quitado...)
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              caducados++
              await sb.from('suscripciones_push').delete().eq('id', s.id)
            } else {
              console.error('push fallido', err?.statusCode, err?.body ?? err?.message)
            }
          }),
      )
    }
  }
  await Promise.all(tareas)
  return Response.json({ enviados, caducados })
})
