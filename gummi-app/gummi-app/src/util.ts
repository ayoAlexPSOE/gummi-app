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
