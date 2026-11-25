import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { horario } from './util'

const OPCIONES: [string, string, string][] = [['voy', 'Voy', '✅'], ['duda', 'Duda', '🤔'], ['no_voy', 'No voy', '❌']]

function cuenta(hasta: number) {
  const m = Math.max(0, Math.floor((hasta - Date.now()) / 60000))
  return { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60), m: m % 60 }
}

export default function Inicio({ yo, onPartido, onVotar }: { yo: any; onPartido: (id: number) => void; onVotar: () => void }) {
  const [d, setD] = useState<any>(null)
  const [, setTick] = useState(0)

  const cargar = async () => {
    const [ps, cf, rk] = await Promise.all([
      supabase.from('partidos').select('*').order('fecha', { ascending: false }).limit(12),
      supabase.from('configuracion').select('*').single(),
      supabase.rpc('ranking_jugadores'),
    ])
    const lista: any[] = ps.data || []
    const ids = lista.map((p) => p.id)
    const [cv, pa, vo, mv] = await Promise.all([
      ids.length ? supabase.from('convocatorias').select('*').in('partido_id', ids) : { data: [] as any[] },
      ids.length ? supabase.from('participaciones').select('*').in('partido_id', ids) : { data: [] as any[] },
      supabase.from('votos').select('partido_id').eq('votante_id', yo.id),
      supabase.from('votos_mvp').select('partido_id').eq('votante_id', yo.id),
    ])
    setD({
      lista, cfg: cf.data, conv: (cv as any).data || [], part: (pa as any).data || [],
      misVotos: new Set([...(vo.data || []), ...(mv.data || [])].map((x: any) => x.partido_id)),
      yoStats: (rk.data || []).find((r: any) => r.jugador_id === yo.id) || null,
    })
  }
  useEffect(() => { cargar() }, [])
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000)
    return () => clearInterval(t)
  }, [])

  if (!d) return <p className="c">Cargando…</p>
  const ahora = Date.now()

  // Próximo partido: el más cercano que aún no ha terminado
  const proximos = d.lista
    .filter((p: any) => (p.estado === 'convocatoria' || p.estado === 'equipos') && (p.fecha_fin ? new Date(p.fecha_fin).getTime() : new Date(p.fecha).getTime() + 3 * 3600000) > ahora)
    .sort((a: any, b: any) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime())
  const prox = proximos[0]
  const ultimo = d.lista.find((p: any) => (p.estado === 'jugado' || p.estado === 'cerrado') && p.goles_a != null)

  // Votaciones abiertas en las que he jugado y aún no he votado
  const pendientes = d.lista.filter(
    (p: any) =>
      p.estado === 'jugado' && p.votacion_hasta && new Date(p.votacion_hasta).getTime() > ahora &&
      d.part.some((x: any) => x.partido_id === p.id && x.jugador_id === yo.id) &&
      !d.misVotos.has(p.id)
  )

  const responder = async (partido_id: number, respuesta: string) => {
    const { error } = await supabase.from('convocatorias').upsert(
      { partido_id, jugador_id: yo.id, respuesta, updated_at: new Date().toISOString() },
      { onConflict: 'partido_id,jugador_id' }
    )
    if (error) alert(error.message)
    else cargar()
  }

  const fmt = (iso: string, largo = false) =>
    new Date(iso).toLocaleString('es-ES', largo
      ? { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short', day: 'numeric', month: 'short' })

  const pct = d.yoStats && d.yoStats.partidos > 0 ? Math.round((100 * d.yoStats.victorias) / d.yoStats.partidos) : null

  return (
    <>
      {prox ? (() => {
        const mia = d.conv.find((c: any) => c.partido_id === prox.id && c.jugador_id === yo.id)
        const voy = d.conv.filter((c: any) => c.partido_id === prox.id && c.respuesta === 'voy').length
        const c = cuenta(new Date(prox.fecha).getTime())
        const miEq = d.part.find((x: any) => x.partido_id === prox.id && x.jugador_id === yo.id)
        const empezado = new Date(prox.fecha).getTime() <= ahora
        return (
          <div className="hero">
            <div className="mut" style={{ textTransform: 'uppercase', letterSpacing: 1, fontSize: 11 }}>Próximo partido</div>
            <div className="hero-t" onClick={() => onPartido(prox.id)}>{(() => {
              const [dia, h] = horario(prox, true).split(' · ')
              return <>{dia}<br /><span className="hero-h">{h}</span></>
            })()}</div>
            <div className="mut">{prox.lugar || 'Sin lugar'} · {voy} confirmados</div>
            {empezado ? (
              <div className="mut" style={{ margin: '10px 0' }}>En juego ahora</div>
            ) : (
              <div className="grid3" style={{ margin: '12px 0' }}>
                <div className="tile"><b>{c.d}</b><span className="mut">días</span></div>
                <div className="tile"><b>{c.h}</b><span className="mut">horas</span></div>
                <div className="tile"><b>{c.m}</b><span className="mut">min</span></div>
              </div>
            )}
            {prox.estado === 'equipos' && miEq && (
              <div className="aviso">⚽ Equipos listos: juegas en el <b>equipo {miEq.equipo}</b></div>
            )}
            {prox.estado === 'convocatoria' && (
              <div className="grid3">
                {OPCIONES.map(([v, t, ic]) => (
                  <button key={v} className={'grande' + (mia?.respuesta === v ? ' sel' : ' sec')} onClick={() => responder(prox.id, v)}>
                    <div style={{ fontSize: 20 }}>{ic}</div>{t}
                  </button>
                ))}
              </div>
            )}
            <button className="sec" style={{ marginTop: 10, width: '100%' }} onClick={() => onPartido(prox.id)}>Ver detalle</button>
          </div>
        )
      })() : (
        <div className="hero">
          <b>No hay ningún partido convocado</b>
          <div className="mut">Cuando el admin cree uno, aparecerá aquí.</div>
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="card alerta" onClick={onVotar}>
          <b>🗳️ Tienes {pendientes.length === 1 ? 'un partido' : pendientes.length + ' partidos'} por votar</b>
          <div className="mut">Quedan {(() => { const c = cuenta(new Date(pendientes[0].votacion_hasta).getTime()); return c.d * 24 + c.h })()} h en el más urgente · Toca para votar</div>
        </div>
      )}
      {d.cfg?.votacion_inicial_abierta && (
        <div className="card alerta" onClick={onVotar}>
          <b>📋 Votación inicial abierta</b>
          <div className="mut">Puntúa a tus compañeros · Toca para votar</div>
        </div>
      )}

      {ultimo && (
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => onPartido(ultimo.id)}>
          <div className="mut">Último resultado · {fmt(ultimo.fecha)}</div>
          <div style={{ fontSize: 30, fontWeight: 700, textAlign: 'center', padding: '6px 0' }}>{ultimo.goles_a} - {ultimo.goles_b}</div>
          <div className="mut" style={{ textAlign: 'center' }}>Ver detalle ›</div>
        </div>
      )}

      {d.yoStats && d.yoStats.partidos > 0 && (
        <>
          <h2>Tus números</h2>
          <div className="grid3">
            <div className="tile"><b>{d.yoStats.partidos}</b><span className="mut">Partidos</span></div>
            <div className="tile"><b>{pct !== null ? pct + '%' : '–'}</b><span className="mut">Victorias</span></div>
            <div className="tile"><b>{d.yoStats.mvps}</b><span className="mut">MVP</span></div>
            <div className="tile"><b>{d.yoStats.goles}</b><span className="mut">Goles</span></div>
            <div className="tile"><b>{d.yoStats.asistencias}</b><span className="mut">Asistencias</span></div>
          </div>
        </>
      )}
    </>
  )
}
