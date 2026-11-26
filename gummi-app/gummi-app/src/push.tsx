// Avisos al móvil con la app cerrada (Web Push): activar, desactivar y la tarjeta para hacerlo.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { vibra } from './movil'

// Clave pública VAPID (es pública: puede estar en el código). La privada solo la tiene Supabase.
const CLAVE_PUBLICA = 'BIOgxJVy1yUAdzv3pNeVE7fo_Ob20sts4FlQZJ46B2eGCc-ZOhRUO1dHWvVh3_kmvTFKTrobmGfLhjCSs9XZS8A'

export type EstadoPush = 'cargando' | 'no-soportado' | 'ios-instalar' | 'denegado' | 'activo' | 'inactivo'

export const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const instalada = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true
const soporta = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function claveBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const nombreDispositivo = () => {
  const ua = navigator.userAgent
  return (/iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad' : /android/i.test(ua) ? 'Android' : /mac/i.test(ua) ? 'Mac' : /windows/i.test(ua) ? 'Windows' : 'Otro') + (instalada() ? ' (app)' : ' (web)')
}

export async function registrarSW() {
  if (!('serviceWorker' in navigator)) return null
  try { return await navigator.serviceWorker.register('./sw.js', { scope: './' }) } catch { return null }
}

export async function estadoPush(): Promise<EstadoPush> {
  if (esIOS() && !instalada()) return 'ios-instalar'
  if (!soporta()) return 'no-soportado'
  if (Notification.permission === 'denied') return 'denegado'
  const reg = await navigator.serviceWorker.getRegistration('./')
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'activo' : 'inactivo'
}

async function guardar(sub: PushSubscription) {
  const j: any = sub.toJSON()
  const { error } = await supabase.rpc('guardar_suscripcion', {
    p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_dispositivo: nombreDispositivo(),
  })
  if (error) throw new Error(/guardar_suscripcion/.test(error.message) ? 'Falta ejecutar en Supabase el script 15_avisos_push.sql' : error.message)
}

export async function activarPush() {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('No has dado permiso para los avisos')
  const reg = (await registrarSW()) || (await navigator.serviceWorker.ready)
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBytes(CLAVE_PUBLICA) })
  await guardar(sub)
}

export async function desactivarPush() {
  const reg = await navigator.serviceWorker.getRegistration('./')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.rpc('quitar_suscripcion', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
}

// Al abrir la app: si este móvil ya tiene avisos, se vuelve a apuntar a nombre de quien
// está dentro (por si cambió de cuenta o el navegador renovó la suscripción).
export async function refrescarSuscripcion() {
  try {
    if (!soporta() || Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker.getRegistration('./')
    const sub = await reg?.pushManager.getSubscription()
    if (sub) await guardar(sub)
  } catch { /* sin SQL todavía o sin conexión: no pasa nada */ }
}

// ---------- Tarjeta "Avisos en el móvil" ----------
export function TarjetaAvisos({ compacta = false, onCerrar }: { compacta?: boolean; onCerrar?: () => void }) {
  const [estado, setEstado] = useState<EstadoPush>('cargando')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const recargar = () => estadoPush().then(setEstado).catch(() => setEstado('no-soportado'))
  useEffect(() => { recargar() }, [])

  const activar = async () => {
    setBusy(true); setMsg('')
    try { await activarPush(); vibra(25); setMsg('✅ Avisos activados en este móvil') }
    catch (e: any) { setMsg(e?.message || 'No se pudieron activar') }
    setBusy(false); recargar()
  }
  const desactivar = async () => {
    setBusy(true)
    try { await desactivarPush(); setMsg('Avisos desactivados en este móvil') } catch { /* */ }
    setBusy(false); recargar()
  }
  const probar = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('probar_push')
    setBusy(false)
    setMsg(error ? error.message : '📨 Enviado. Bloquea el móvil: debería llegarte en unos segundos.')
  }

  if (estado === 'cargando') return null
  if (compacta && (estado === 'activo' || estado === 'no-soportado' || estado === 'denegado')) return null

  return (
    <div className={'card avisos-movil' + (compacta ? ' compacta' : '')}>
      <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <span className="avisos-ic">{estado === 'activo' ? '🔔' : '📲'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b>{estado === 'activo' ? 'Avisos activados en este móvil' : 'Avisos en el móvil'}</b>
          <div className="mut">
            {estado === 'activo' && 'Te llegarán partidos, equipos, votaciones y logros aunque tengas la app cerrada.'}
            {estado === 'inactivo' && 'Entérate de los partidos, los equipos y las votaciones aunque tengas la app cerrada.'}
            {estado === 'denegado' && 'Los tienes bloqueados. Actívalos en los ajustes del móvil: Notificaciones › Gummi (o en los permisos de la web en Chrome).'}
            {estado === 'no-soportado' && 'Este navegador no admite avisos. En Android usa Chrome; en iPhone, añade la app a la pantalla de inicio.'}
            {estado === 'ios-instalar' && <>En iPhone primero hay que instalar la app: toca <b>Compartir</b> <span className="ios-ic">⎋</span> y luego <b>Añadir a pantalla de inicio</b>. Ábrela desde el icono y activa aquí los avisos.</>}
          </div>
        </span>
        {compacta && onCerrar && <button className="sec mini ico" onClick={onCerrar} aria-label="Ahora no">✕</button>}
      </div>
      {estado === 'inactivo' && <button style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={activar}>🔔 Activar avisos</button>}
      {estado === 'activo' && !compacta && (
        <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
          <button className="sec" style={{ flex: 1 }} disabled={busy} onClick={probar}>Enviar prueba</button>
          <button className="sec" disabled={busy} onClick={desactivar}>Desactivar</button>
        </div>
      )}
      {msg && <div className="mut" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  )
}
