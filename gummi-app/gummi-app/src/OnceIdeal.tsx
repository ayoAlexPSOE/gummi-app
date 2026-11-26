import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Avatar from './Avatar'

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })

// Puntos de ataque: quien marca o asiste va delante; los defensas, atrás.
const ataque = (r: any) =>
  r.goles * 10 + r.asistencias * 4 +
  (({ delantero: 3, banda: 2.5, medio: 2, defensa: 0, portero: 0 } as any)[r.posicion] || 0) +
  (r.posicion ? 0 : 1) + Number(r.nota) / 10

export default function OnceIdeal({ perfiles, onFicha }: { perfiles: any[]; onFicha: (id: string) => void }) {
  const [partidos, setPartidos] = useState<any[] | null>(null)
  const [idx, setIdx] = useState(0)
  const [filas, setFilas] = useState<any[] | null>(null)
  const [sinSql, setSinSql] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('partidos').select('id,fecha,votacion_hasta,estado')
        .in('estado', ['jugado', 'cerrado']).order('fecha', { ascending: false }).limit(12)
      setPartidos((data || []).filter((p: any) => p.votacion_hasta && new Date(p.votacion_hasta).getTime() < Date.now()))
    })()
  }, [])

  useEffect(() => {
    if (!partidos || partidos.length === 0) return
    setFilas(null)
    supabase.rpc('once_ideal', { p_partido: partidos[idx].id }).then(({ data, error }) => { setSinSql(!!error); setFilas(error ? [] : data || []) })
  }, [partidos, idx])

  if (!partidos) return null
  if (partidos.length === 0) {
    return (
      <div className="once">
        <b className="once-t">⭐ Once ideal</b>
        <p className="mut" style={{ margin: '6px 0 0' }}>
          Aparecerá cuando termine la votación (48 h después de cerrar) de un partido en el que se haya votado.
        </p>
      </div>
    )
  }
  const hay = filas && filas.length > 0
  const cab = filas && filas[0]

  // Reparto 1-3-2 (delantero, medios, defensas) según ataque
  const orden = (filas || []).slice().sort((a, b) => ataque(b) - ataque(a))
  const n = orden.length
  const delante = n >= 1 ? 1 : 0
  const atras = n >= 5 ? 2 : n >= 3 ? 1 : 0
  const medio = n - delante - atras
  const filasCampo = [orden.slice(0, delante), orden.slice(delante, delante + medio), orden.slice(delante + medio)].filter((f) => f.length)

  const Ficha = ({ r }: { r: any }) => {
    const p = perfiles.find((x) => x.id === r.jugador_id)
    return (
      <div className="jug-once" onClick={() => onFicha(r.jugador_id)}>
        <div className="foto">
          {r.es_mvp && <span className="corona">👑</span>}
          <Avatar p={p} size={42} />
        </div>
        <div className="n">{p?.apodo || p?.nombre || '?'}</div>
        <div className="s">
          {r.goles > 0 && `⚽${r.goles}`}
          {r.goles > 0 && r.asistencias > 0 && ' '}
          {r.asistencias > 0 && `🅰️${r.asistencias}`}
        </div>
      </div>
    )
  }

  return (
    <div className="once">
      <div className="row" style={{ flexWrap: 'nowrap', marginBottom: 6 }}>
        <button className="sec mini" disabled={idx >= partidos.length - 1} onClick={() => setIdx(idx + 1)} aria-label="Partido anterior">‹</button>
        <span style={{ flex: 1, textAlign: 'center' }}>
          <b className="once-t">⭐ Once ideal</b>
          <div className="mut">
            {fmt(partidos[idx].fecha)}
            {cab && cab.goles_a != null ? ` · ${cab.goles_a}-${cab.goles_b}` : ''}
          </div>
        </span>
        <button className="sec mini" disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="Partido siguiente">›</button>
      </div>
      {!filas && <p className="mut c" style={{ padding: 12 }}>Cargando…</p>}
      {filas && !hay && (
        <p className="mut c" style={{ padding: 12 }}>
          {sinSql ? 'Falta ejecutar en Supabase el script 12_once_ideal.sql.' : 'Sin votos suficientes en este partido.'}
        </p>
      )}
      {hay && (
        <div className="campo">
          {filasCampo.map((f, i) => (
            <div className="linea" key={i}>
              {f.map((r: any) => <Ficha key={r.jugador_id} r={r} />)}
            </div>
          ))}
        </div>
      )}
      {hay && <div className="mut" style={{ textAlign: 'center', marginTop: 4, fontSize: 11 }}>Los 6 de campo mejor votados · 👑 MVP</div>}
    </div>
  )
}
