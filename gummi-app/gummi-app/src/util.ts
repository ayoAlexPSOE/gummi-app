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
