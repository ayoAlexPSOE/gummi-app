// Utilidades pensadas para el móvil: botón/gesto "atrás", vibración, compartir,
// añadir al calendario y el indicador de carga.
import { useEffect, useRef } from 'react'

// ---------- Botón "atrás" del móvil ----------
// Cada pantalla que se abre encima de otra (detalle de partido, ficha, otra pestaña)
// apunta una entrada en el historial. Al pulsar "atrás" en Android o deslizar en iPhone
// se cierra la de más arriba en vez de salirse de la web.
type Entrada = { cerrar: () => void; viaAtras: boolean }
const pila: Entrada[] = []
let ignorar = 0
let pendientes = 0
let programado = false

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorar > 0) { ignorar--; return }
    const e = pila.pop()
    if (e) { e.viaAtras = true; e.cerrar() }
  })
}

// Quita del historial las entradas de pantallas cerradas con un botón de la app
// (se agrupan para dar un solo salto aunque se cierren varias a la vez).
function retroceder() {
  pendientes++
  if (programado) return
  programado = true
  queueMicrotask(() => {
    programado = false
    const k = pendientes
    pendientes = 0
    ignorar++
    history.go(-k)
  })
}

export function useAtras(activo: boolean, cerrar: () => void) {
  const ref = useRef(cerrar)
  ref.current = cerrar
  useEffect(() => {
    if (!activo) return
    const e: Entrada = { cerrar: () => ref.current(), viaAtras: false }
    pila.push(e)
    history.pushState({ gummi: pila.length }, '')
    return () => {
      if (e.viaAtras) return
      const i = pila.indexOf(e)
      if (i >= 0) pila.splice(i, 1)
      retroceder()
    }
  }, [activo])
}

// ---------- Vibración corta al confirmar algo (solo Android; en iPhone no hace nada) ----------
export const vibra = (ms = 12) => {
  try { navigator.vibrate?.(ms) } catch { /* sin soporte */ }
}

// ---------- Compartir (menú nativo del móvil o WhatsApp) ----------
export async function compartir(texto: string) {
  const url = location.href.split('#')[0].split('?')[0]
  const completo = `${texto}\n\n👉 ${url}`
  if (navigator.share) {
    try { await navigator.share({ text: completo }); return } catch (e: any) { if (e?.name === 'AbortError') return }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(completo), '_blank')
}

// ---------- Añadir al calendario (.ics, lo abre el calendario del móvil) ----------
export function anadirCalendario(p: { id: number; fecha: string; fecha_fin?: string | null; lugar?: string | null }) {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ini = new Date(p.fecha)
  const fin = p.fecha_fin ? new Date(p.fecha_fin) : new Date(ini.getTime() + 3600000)
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gummi//ES', 'BEGIN:VEVENT',
    `UID:gummi-partido-${p.id}@gummi.app`, `DTSTAMP:${f(new Date())}`,
    `DTSTART:${f(ini)}`, `DTEND:${f(fin)}`,
    'SUMMARY:⚽ Partido de la peña', p.lugar ? `LOCATION:${p.lugar.replace(/[,;]/g, ' ')}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Partido en 2 horas', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  a.download = `partido-${p.id}.ics`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

// ---------- Indicador de carga ----------
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="cargando" role="status">
      <span className="balon">⚽</span>
      <span>{texto}</span>
    </div>
  )
}
