import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { aviso } from './dialogos'
import { configuracion } from './datos'
import { color } from './equipos'
import { ESTADOS, horario, convocados, respuestaLocal, PLAZAS_DEFECTO } from './util'
import PartidoDetalle from './PartidoDetalle'
import { Cargando, useAtras, vibra } from './movil'

const OPCIONES: [string, string, string][] = [['voy', 'Voy', '✅'], ['duda', 'Duda', '🤔'], ['no_voy', 'No voy', '❌']]

// El partido abierto se recuerda al refrescar (tirar hacia abajo) y se olvida al cambiar de pestaña.
let recordado: number | null = null
export const olvidarPartido = () => { recordado = null }

export default function Partidos({ yo, abrirInicial, onUsado }: { yo: any; abrirInicial?: number | null; onUsado?: () => void }) {
  const [partidos, setPartidos] = useState<any[] | null>(null)
  const [conv, setConv] = useState<any[]>([])
  const [part, setPart] = useState<any[]>([])
  const [abierto, setAbiertoEstado] = useState<number | null>(abrirInicial || recordado)
  const [verTodos, setVerTodos] = useState(false)
  const [plazas, setPlazas] = useState(PLAZAS_DEFECTO)
  const setAbierto = (v: number | null) => { recordado = v; setAbiertoEstado(v) }

  useAtras(abierto !== null, () => setAbierto(null))

  const cargar = async () => {
    // Solo los 40 partidos más recientes (así nunca se supera el límite de filas por consulta)
    const p = await supabase.from('partidos').select('*').order('fecha', { ascending: false }).limit(40)
    const ids = (p.data || []).map((x: any) => x.id)
    const [c, pa]: any = ids.length
      ? await Promise.all([
          supabase.from('convocatorias').select('*').in('partido_id', ids),
          supabase.from('participaciones').select('partido_id,jugador_id,equipo').eq('jugador_id', yo.id).in('partido_id', ids),
        ])
      : [{ data: [] }, { data: [] }]
    setPartidos(p.data || [])
    const cf = await configuracion()
    if (!cf.error && cf.data?.plazas) setPlazas(cf.data.plazas)
    setConv(c.data || [])
    setPart(pa.data || [])
  }
  useEffect(() => { if (abierto === null) cargar() }, [abierto])
  useEffect(() => {
    if (abrirInicial) { setAbierto(abrirInicial); onUsado && onUsado() }
  }, [abrirInicial])

  const responder = async (partido_id: number, respuesta: string) => {
    vibra()
    // Se marca al momento y se guarda por detrás
    setConv((cs) => respuestaLocal(cs, partido_id, yo.id, respuesta))
    const { error } = await supabase.from('convocatorias').upsert(
      { partido_id, jugador_id: yo.id, respuesta, updated_at: new Date().toISOString() },
      { onConflict: 'partido_id,jugador_id' }
    )
    if (error) aviso(error.message, 'error')
    cargar()
  }

  if (abierto !== null) {
    return <PartidoDetalle id={abierto} yo={yo} onBack={() => setAbierto(null)} />
  }
  if (!partidos) return <Cargando />

  const ahora = Date.now()
  const proximos = partidos
    .filter((p) => p.estado === 'convocatoria' || p.estado === 'equipos')
    .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
  const jugados = partidos.filter((p) => p.estado === 'jugado' || p.estado === 'cerrado')
  const visibles = verTodos ? jugados : jugados.slice(0, 8)

  const tarjeta = (p: any) => {
    const mias = conv.find((c) => c.partido_id === p.id && c.jugador_id === yo.id)
    const { titulares, reservas } = convocados(conv, p.id, plazas)
    const voy = titulares.length
    const miEq = part.find((x) => x.partido_id === p.id)
    const hayRes = p.goles_a != null
    let res = ''
    if (hayRes && miEq) {
      const gf = miEq.equipo === 'A' ? p.goles_a : p.goles_b
      const gc = miEq.equipo === 'A' ? p.goles_b : p.goles_a
      res = gf > gc ? 'V' : gf < gc ? 'D' : 'E'
    }
    const votando = p.estado === 'jugado' && p.votacion_hasta && new Date(p.votacion_hasta).getTime() > ahora
    return (
      <div className="card partido" key={p.id} onClick={() => setAbierto(p.id)}>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <span className="f1 min0">
            <b className="partido-dia">{horario(p)}</b>
            <div className="mut">{[p.lugar, !hayRes ? `${voy} ${voy === 1 ? 'va' : 'van'}${reservas.length ? ` (+${reservas.length} reserva${reservas.length > 1 ? 's' : ''})` : ''}` : ''].filter(Boolean).join(' · ')}</div>
          </span>
          {hayRes ? (
            <span className="marcador-mini">
              {res && <span className={'chip ' + res}>{res}</span>}
              <b>{p.goles_a}<i>–</i>{p.goles_b}</b>
            </span>
          ) : (
            <span className={'tag estado-' + p.estado}>{ESTADOS[p.estado] || p.estado}</span>
          )}
        </div>
        {votando && <div className="mut mt4">🗳️ Votación abierta</div>}
        {p.estado === 'convocatoria' && (
          <div className="grid3 mt10" onClick={(e) => e.stopPropagation()}>
            {OPCIONES.map(([v, t, ic]) => (
              <button key={v} className={'sec mini' + (mias?.respuesta === v ? ' on2' : '')} onClick={() => responder(p.id, v)}>{ic} {t}</button>
            ))}
          </div>
        )}
        {p.estado === 'equipos' && miEq && (() => {
          const c = color(miEq.equipo === 'A' ? p.color_a : p.color_b)
          return (
            <div className="aviso equipo-aviso mt8 mb0">
              {c ? <><span className="camiseta" style={{ ['--m' as any]: c.hex }} /><span>Juegas con los <b>{c.plural.toLowerCase()}</b></span></> : <span>Juegas en el <b>equipo {miEq.equipo}</b></span>}
            </div>
          )
        })()}
      </div>
    )
  }

  return (
    <>
      {partidos.length === 0 && (
        <div className="vacio"><span>🗓️</span><b>Todavía no hay partidos</b><div className="mut">Cuando el admin cree uno, aparecerá aquí.</div></div>
      )}
      {proximos.length > 0 && <h2>Próximos partidos</h2>}
      {proximos.map(tarjeta)}
      {jugados.length > 0 && <h2>Resultados</h2>}
      {visibles.map(tarjeta)}
      {jugados.length > visibles.length && (
        <button className="sec w100 mt6" onClick={() => setVerTodos(true)}>Ver los {jugados.length - visibles.length} anteriores</button>
      )}
    </>
  )
}
