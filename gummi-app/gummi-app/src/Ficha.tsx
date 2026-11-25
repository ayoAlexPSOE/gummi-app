import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { traerTodo } from './util'

const MIN_PAREJA = 3

export default function Ficha({ id, yo, onBack }: { id: string; yo: any; onBack: () => void }) {
  const [d, setD] = useState<any>(null)

  useEffect(() => {
    ;(async () => {
      const [pr, rk, ps, pa, ev, nt] = await Promise.all([
        supabase.from('perfiles').select('*').eq('activo', true),
        supabase.rpc('ranking_jugadores'),
        traerTodo('partidos', ['fecha', 'id'], (q) =>
          q.in('estado', ['jugado', 'cerrado']).not('goles_a', 'is', null).not('goles_b', 'is', null)
        ),
        traerTodo('participaciones', ['partido_id', 'jugador_id']),
        traerTodo('eventos', ['id'], (q) => q.eq('jugador_id', id)),
        supabase.rpc('notas_jugadores'), // da error si las notas no son visibles para este usuario
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

      setD({
        perfil, stats, historial, racha, nota,
        mejorComp: mejorComp ? { nombre: nombre(mejorComp[0]), ...mejorComp[1] } : null,
        peorRival:
          peorRival && peorRival[1].v / peorRival[1].n < 0.5
            ? { nombre: nombre(peorRival[0]), ...peorRival[1] }
            : null,
      })
    })()
  }, [id])

  if (!d) return <p className="c">Cargando ficha…</p>
  const { perfil, stats, historial, racha, nota, mejorComp, peorRival } = d
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
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
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
      <b>{valor ?? '–'}</b>
      <span className="mut">{titulo}</span>
    </div>
  )

  return (
    <>
      <div className="row" style={{ margin: '12px 0' }}>
        <button className="sec mini" onClick={onBack}>← Volver</button>
      </div>
      <h2 style={{ marginTop: 0 }}>{perfil.apodo || perfil.nombre}</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        {perfil.posicion && <span className="tag">{perfil.posicion}</span>}
        {perfil.es_externo && <span className="tag">externo</span>}
        {nota?.fuente === 'votos' && nota.nota != null && (
          <span className="tag">Nota {Number(nota.nota).toFixed(1)}</span>
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
            <div style={{ margin: '4px 0' }}>
              🤝 <b>Mejor pareja:</b> {mejorComp.nombre}{' '}
              <span className="mut">
                (ganáis el {Math.round((100 * mejorComp.v) / mejorComp.n)}% de {mejorComp.n} partidos juntos)
              </span>
            </div>
          )}
          {peorRival && (
            <div style={{ margin: '4px 0' }}>
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
              <span style={{ flex: 1 }}>
                {fmt(h.p.fecha)} · {h.gf}-{h.gc}
                <div className="mut">Equipo {h.equipo}</div>
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
