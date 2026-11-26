import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Media from './Media'
import { perfilesActivos, ranking } from './datos'
import { nombreEquipo } from './equipos'
import Numero from './Numero'
import { fecha, traerTodo } from './util'
import Avatar from './Avatar'
import { Cargando } from './movil'
import { nombrePos } from './equipos'

const MIN_PAREJA = 3

export default function Ficha({ id, yo, onBack }: { id: string; yo: any; onBack: () => void }) {
  const [d, setD] = useState<any>(null)

  useEffect(() => {
    ;(async () => {
      // Solo los partidos de este jugador (y quién jugó en ellos), no todo el historial de la peña
      const mios = await traerTodo('participaciones', ['partido_id'], (q) => q.eq('jugador_id', id))
      const idsPartidos = [...new Set(mios.map((x: any) => x.partido_id))]
      const trozos = (ids: number[]) => Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150))
      const enTrozos = async (tabla: string, orden: string[], extra: (q: any) => any = (q) => q) =>
        (await Promise.all(trozos(idsPartidos).map((t) => traerTodo(tabla, orden, (q) => extra(q.in(tabla === 'partidos' ? 'id' : 'partido_id', t)))))).flat()
      const [pr, rk, ps, pa, ev, nt, lg, lj] = await Promise.all([
        perfilesActivos(),
        ranking(),
        enTrozos('partidos', ['fecha', 'id'], (q) => q.in('estado', ['jugado', 'cerrado']).not('goles_a', 'is', null).not('goles_b', 'is', null)),
        enTrozos('participaciones', ['partido_id', 'jugador_id']),
        traerTodo('eventos', ['id'], (q) => q.eq('jugador_id', id)),
        supabase.rpc('notas_jugadores'), // solo funciona para el admin
        supabase.from('logros').select('*').order('orden'),
        supabase.from('logros_jugador').select('*').eq('jugador_id', id),
      ])

      const perfiles: any[] = pr.data || []
      const nombre = (jid: string) => {
        const j = perfiles.find((x) => x.id === jid)
        return j ? j.apodo || j.nombre : '?'
      }
      const perfil = perfiles.find((x) => x.id === id)
      const stats =
        (rk.data || []).find((r: any) => r.jugador_id === id) ||
        { partidos: 0, victorias: 0, empates: 0, derrotas: 0, goles: 0, asistencias: 0, mvps: 0 }

      const partidoPorId = new Map<number, any>()
      for (const p of ps) partidoPorId.set(p.id, p)

      const porPartido = new Map<number, any[]>()
      for (const x of pa) {
        if (!partidoPorId.has(x.partido_id)) continue
        const lista = porPartido.get(x.partido_id) || []
        lista.push(x)
        porPartido.set(x.partido_id, lista)
      }

      const porEvento = new Map<number, { g: number; a: number }>()
      for (const e of ev) {
        const c = porEvento.get(e.partido_id) || { g: 0, a: 0 }
        if (e.tipo === 'gol') c.g++
        else c.a++
        porEvento.set(e.partido_id, c)
      }

      const historial = pa
        .filter((x) => x.jugador_id === id && partidoPorId.has(x.partido_id))
        .map((x) => {
          const p = partidoPorId.get(x.partido_id)
          const gf = x.equipo === 'A' ? p.goles_a : p.goles_b
          const gc = x.equipo === 'A' ? p.goles_b : p.goles_a
          const res = gf > gc ? 'V' : gf < gc ? 'D' : 'E'
          return { p, equipo: x.equipo, gf, gc, res, ev: porEvento.get(p.id) || { g: 0, a: 0 } }
        })
        .sort((a, b) => new Date(b.p.fecha).getTime() - new Date(a.p.fecha).getTime())

      // Racha actual
      let racha = 0
      for (const h of historial) {
        if (h.res === historial[0].res) racha++
        else break
      }

      // Compañeros y rivales
      const comp: Record<string, { n: number; v: number }> = {}
      const riv: Record<string, { n: number; v: number }> = {}
      for (const h of historial) {
        for (const o of porPartido.get(h.p.id) || []) {
          if (o.jugador_id === id) continue
          const tabla = o.equipo === h.equipo ? comp : riv
          if (!tabla[o.jugador_id]) tabla[o.jugador_id] = { n: 0, v: 0 }
          tabla[o.jugador_id].n++
          if (h.res === 'V') tabla[o.jugador_id].v++
        }
      }
      const ordenar = (t: Record<string, { n: number; v: number }>, asc: boolean) =>
        Object.entries(t)
          .filter(([, x]) => x.n >= MIN_PAREJA)
          .sort(([, a], [, b]) => {
            const dif = a.v / a.n - b.v / b.n
            return (asc ? dif : -dif) || b.n - a.n
          })[0]
      const mejorComp = ordenar(comp, false)
      const peorRival = ordenar(riv, true)

      let nota: any = null
      if (!nt.error) nota = (nt.data || []).find((r: any) => r.jugador_id === id) || null

      const logros: any[] = []
      for (const l of lg.data || []) {
        const n = (lj.data || []).filter((x: any) => x.logro_id === l.id).length
        if (n > 0) logros.push({ ...l, n })
      }

      setD({
        perfil, stats, historial, racha, nota, logros,
        mejorComp: mejorComp ? { nombre: nombre(mejorComp[0]), ...mejorComp[1] } : null,
        peorRival:
          peorRival && peorRival[1].v / peorRival[1].n < 0.5
            ? { nombre: nombre(peorRival[0]), ...peorRival[1] }
            : null,
      })
    })()
  }, [id])

  if (!d) return <Cargando texto="Cargando ficha…" />
  const { perfil, stats, historial, racha, nota, mejorComp, peorRival, logros } = d
  if (!perfil) {
    return (
      <>
        <button className="sec mini" onClick={onBack}>← Volver</button>
        <p className="mut">No se ha encontrado al jugador.</p>
      </>
    )
  }

  const pct = stats.partidos > 0 ? Math.round((100 * stats.victorias) / stats.partidos) : null
  const gpp = stats.partidos > 0 ? (stats.goles / stats.partidos).toFixed(2) : null
  const fmt = (iso: string) => fecha(iso, 'dia')
  const textoRacha =
    historial.length === 0
      ? ''
      : historial[0].res === 'V'
        ? `${racha} ${racha === 1 ? 'victoria' : 'victorias'} seguidas`
        : historial[0].res === 'D'
          ? `${racha} ${racha === 1 ? 'derrota' : 'derrotas'} seguidas`
          : `${racha} ${racha === 1 ? 'empate' : 'empates'} seguidos`

  const Tile = ({ valor, titulo }: { valor: any; titulo: string }) => (
    <div className="tile">
      <b>{typeof valor === 'number' ? <Numero v={valor} /> : (valor ?? '–')}</b>
      <span className="mut">{titulo}</span>
    </div>
  )

  return (
    <>
      <div className="row my12">
        <button className="sec mini" onClick={onBack}>← Volver</button>
      </div>
      <div className="perfil-cab">
        <Avatar p={perfil} size={72} />
        <div className="f1 min0">
          <div className="perfil-nombre">{perfil.apodo || perfil.nombre}</div>
          {perfil.apodo && <div className="mut">{perfil.nombre}</div>}
        </div>
        {perfil.dorsal != null && <div className="perfil-info"><div className="dorsal" title="Dorsal"><small>DORSAL</small>{perfil.dorsal}</div></div>}
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        {perfil.posicion && <span className={'tag pos-' + perfil.posicion}>{nombrePos(perfil.posicion)}</span>}
        {(perfil.posiciones_secundarias || []).map((s: string) => (
          <span key={s} className={'tag o70 pos-' + s}>{nombrePos(s)}</span>
        ))}
        {perfil.pierna && <span className="tag">🦶 {perfil.pierna}</span>}
        {perfil.es_externo && <span className="tag">externo</span>}
        {nota?.nota != null && (
          <span className="media-ficha"><Media nota={nota.nota} grande /><span className="mut">solo tú la ves</span></span>
        )}
      </div>

      <div className="grid3">
        <Tile valor={stats.partidos} titulo="Partidos" />
        <Tile valor={pct !== null ? pct + '%' : null} titulo="Victorias" />
        <Tile valor={stats.mvps} titulo="MVP" />
        <Tile valor={stats.goles} titulo="Goles" />
        <Tile valor={stats.asistencias} titulo="Asistencias" />
        <Tile valor={gpp} titulo="Goles/partido" />
      </div>
      <p className="mut">
        {stats.victorias} victorias · {stats.empates} empates · {stats.derrotas} derrotas
      </p>

      {logros.length > 0 && (
        <div className="card">
          <b>🏅 Logros ({logros.length})</b>
          <div className="row mt8">
            {logros.map((l: any) => (
              <span key={l.id} className="tag" title={l.descripcion}>
                {l.icono} {l.nombre}{l.n > 1 ? ` ×${l.n}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {historial.length > 0 && (
        <div className="card">
          <b>Últimos partidos</b>
          <div className="row" style={{ margin: '8px 0 4px' }}>
            {historial.slice(0, 8).map((h: any) => (
              <span key={h.p.id} className={'chip ' + h.res}>{h.res}</span>
            ))}
          </div>
          <div className="mut">{textoRacha}</div>
        </div>
      )}

      {(mejorComp || peorRival) && (
        <div className="card">
          {mejorComp && (
            <div className="my4">
              🤝 <b>Mejor pareja:</b> {mejorComp.nombre}{' '}
              <span className="mut">
                (ganáis el {Math.round((100 * mejorComp.v) / mejorComp.n)}% de {mejorComp.n} partidos juntos)
              </span>
            </div>
          )}
          {peorRival && (
            <div className="my4">
              😈 <b>Bestia negra:</b> {peorRival.nombre}{' '}
              <span className="mut">
                (solo gana el {Math.round((100 * peorRival.v) / peorRival.n)}% de {peorRival.n} partidos en contra)
              </span>
            </div>
          )}
        </div>
      )}
      {!mejorComp && historial.length > 0 && (
        <p className="mut">Las parejas y la bestia negra aparecen a partir de {MIN_PAREJA} partidos juntos o en contra.</p>
      )}

      {historial.length > 0 && (
        <>
          <h2>Historial</h2>
          {historial.slice(0, 10).map((h: any) => (
            <div className="card row" key={h.p.id}>
              <span className={'chip ' + h.res}>{h.res}</span>
              <span className="f1">
                {fmt(h.p.fecha)} · {h.gf}-{h.gc}
                <div className="mut">{nombreEquipo(h.equipo, h.equipo === 'A' ? h.p.color_a : h.p.color_b)}</div>
              </span>
              <span className="mut">
                {h.ev.g > 0 && `⚽${h.ev.g} `}
                {h.ev.a > 0 && `🅰️${h.ev.a}`}
              </span>
            </div>
          ))}
        </>
      )}
      {historial.length === 0 && <p className="mut">Todavía no ha jugado ningún partido cerrado.</p>}
    </>
  )
}
