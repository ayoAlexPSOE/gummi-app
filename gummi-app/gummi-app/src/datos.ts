// Datos compartidos entre pantallas, guardados en memoria un par de minutos para no
// pedir lo mismo a Supabase en cada pantalla. Se vacía al tirar hacia abajo, al volver
// a la app y cada vez que cambias algo que les afecta.
import { supabase } from './supabase'

const DURACION = 2 * 60 * 1000
const memoria = new Map<string, { t: number; p: Promise<any> }>()

function guardado<T>(clave: string, pedir: () => Promise<{ data: T; error: any }>): Promise<{ data: T; error: any }> {
  const e = memoria.get(clave)
  if (e && Date.now() - e.t < DURACION) return e.p
  const p = pedir().then((r) => {
    if (r.error) memoria.delete(clave) // los fallos no se guardan
    return r
  }, (err) => { memoria.delete(clave); throw err })
  memoria.set(clave, { t: Date.now(), p })
  return p
}

// Vacía la memoria (toda, o solo lo que empiece por "prefijo")
export function invalidar(prefijo?: string) {
  for (const k of [...memoria.keys()]) if (!prefijo || k.startsWith(prefijo)) memoria.delete(k)
}

export const perfilesActivos = () =>
  guardado<any[]>('perfiles', async () => {
    const r = await supabase.from('perfiles').select('*').eq('activo', true).order('nombre')
    return { data: r.data || [], error: r.error }
  })

export const configuracion = () =>
  guardado<any>('config', async () => {
    const r = await supabase.from('configuracion').select('*').single()
    return { data: r.data, error: r.error }
  })

export const ranking = (temporada?: number | null) =>
  guardado<any[]>('ranking:' + (temporada ?? 'todas'), async () => {
    const r = temporada ? await supabase.rpc('ranking_jugadores', { p_temporada: temporada }) : await supabase.rpc('ranking_jugadores')
    return { data: r.data || [], error: r.error }
  })
