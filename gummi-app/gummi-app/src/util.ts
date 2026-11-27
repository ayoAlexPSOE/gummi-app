import { supabase } from './supabase'

// Supabase devuelve como máximo 1000 filas por consulta.
// Esta función va pidiendo páginas hasta traerlo todo.
export async function traerTodo(
  tabla: string,
  orden: string[],
  filtro?: (q: any) => any
): Promise<any[]> {
  const salida: any[] = []
  for (let desde = 0; ; desde += 1000) {
    let q: any = supabase.from(tabla).select('*')
    if (filtro) q = filtro(q)
    for (const o of orden) q = q.order(o)
    const { data, error } = await q.range(desde, desde + 999)
    if (error || !data) break
    salida.push(...data)
    if (data.length < 1000) break
  }
  return salida
}

// "jue, 27 nov · 14:00–15:00" (la hora de fin solo si el partido la tiene)
export function horario(p: any, largo = false): string {
  const d = new Date(p.fecha)
  const dia = d.toLocaleDateString('es-ES', largo
    ? { weekday: 'long', day: 'numeric', month: 'long' }
    : { weekday: 'short', day: 'numeric', month: 'short' })
  const h = (x: Date) => x.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return `${dia} · ${h(d)}${p.fecha_fin ? '–' + h(new Date(p.fecha_fin)) : ''}`
}

// Lista de convocados: los primeros en decir "Voy" juegan (hasta llenar las plazas);
// el resto queda de reserva por orden de llegada.
export const PLAZAS_DEFECTO = 14
const llegada = (c: any) => c.voy_desde || c.updated_at || '9999'
export function convocados(conv: any[], partidoId: number, plazas: number = PLAZAS_DEFECTO) {
  const voy = conv
    .filter((c) => c.partido_id === partidoId && c.respuesta === 'voy')
    .sort((a, b) => llegada(a).localeCompare(llegada(b)) || String(a.jugador_id).localeCompare(String(b.jugador_id)))
    .map((c) => c.jugador_id as string)
  return { titulares: voy.slice(0, plazas), reservas: voy.slice(plazas) }
}

// Respuesta marcada al momento (antes de que conteste el servidor) sin perder el orden de llegada.
export function respuestaLocal(conv: any[], partidoId: number, jugadorId: string, respuesta: string) {
  const previa = conv.find((c) => c.partido_id === partidoId && c.jugador_id === jugadorId)
  const resto = conv.filter((c) => !(c.partido_id === partidoId && c.jugador_id === jugadorId))
  if (!respuesta) return resto
  const voy_desde = respuesta === 'voy' ? (previa?.respuesta === 'voy' ? previa.voy_desde || previa.updated_at : new Date().toISOString()) : null
  return [...resto, { partido_id: partidoId, jugador_id: jugadorId, respuesta, voy_desde }]
}

// Nombres de los estados del partido
export const ESTADOS: Record<string, string> = { convocatoria: 'Convocatoria', equipos: 'Equipos hechos', jugado: 'Jugado', cerrado: 'Cerrado' }

// Fechas: 'dia' = "26 nov" · 'corta' = "jue, 26 nov" · 'diaHora' = "jue, 26 nov, 14:00"
export function fecha(iso: string, tipo: 'dia' | 'corta' | 'diaHora' = 'corta') {
  const o: Intl.DateTimeFormatOptions =
    tipo === 'dia' ? { day: 'numeric', month: 'short' }
    : tipo === 'corta' ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  return new Date(iso).toLocaleString('es-ES', o)
}

// "ahora", "hace 5 min", "hace 3 h", "hace 2 d"
export const hace = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  if (m < 1440) return `hace ${Math.floor(m / 60)} h`
  return `hace ${Math.floor(m / 1440)} d`
}
