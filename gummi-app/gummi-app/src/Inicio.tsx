import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { color, nombreEquipo } from './equipos'
import { TarjetaAvisos } from './push'
import { horario } from './util'
import Numero from './Numero'
import Avatar from './Avatar'
import { Cargando, anadirCalendario, vibra } from './movil'

const OPCIONES: [string, string, string][] = [['voy', 'Voy', '✅'], ['duda', 'Duda', '🤔'], ['no_voy', 'No voy', '❌']]

function cuenta(hasta: number) {
  const m = Math.max(0, Math.floor((hasta - Date.now()) / 60000))
  return { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60), m: m % 60 }
}

export default function Inicio({ yo, onPartido, onVotar }: { yo: any; onPartido: (id: number) => void; onVotar: () => void }) {
  const [d, setD] = useState<any>(null)
  const [, setTick] = useState(0)
  const [bannerAvisos, setBannerAvisos] = useState(() => { try { return localStorage.getItem('gummi-banner-avisos') !== 'no' } catch { return true } })
  const cerrarBanner = () => { setBannerAvisos(false); try { localStorage.setItem('gummi-banner-avisos', 'no') } catch { /* */ } }

  const cargar = async () => {
    const [ps, cf, rk, pf] = await Promise.all([
      supabase.from('partidos').select('*').order('fecha', { ascending: false }).limit(12),
      supabase.from('configuracion').select('*').single(),
      supabase.rpc('ranking_jugadores'),
      supabase.from('perfiles').select('*').eq('activo', true),
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
      lista, cfg: cf.data, perfiles: pf.data || [], conv: (cv as any).data || [], part: (pa as any).data || [],
      misVotos: new Set([...(vo.data || []), ...(mv.data || [])].map((x: any) => x.partido_id)),
      yoStats: (rk.data || []).find((r: any) => r.jugador_id === yo.id) || null,
    })
  }
  useEffect(() => { cargar() }, [])
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000)
    return () => clearInterval(t)
  }, [])

  if (!d) return <Cargando />
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
    vibra()
    setD((x: any) => ({ ...x, conv: [...x.conv.filter((c: any) => !(c.partido_id === partido_id && c.jugador_id === yo.id)), { partido_id, jugador_id: yo.id, respuesta }] }))
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
            <div className="mut">📍 {prox.lugar || 'Lugar por confirmar'}</div>
            {(() => {
              const van = d.conv.filter((c: any) => c.partido_id === prox.id && c.respuesta === 'voy')
                .map((c: any) => d.perfiles.find((j: any) => j.id === c.jugador_id)).filter(Boolean)
              return (
                <div className="pila" onClick={() => onPartido(prox.id)}>
                  <span className="pila-fotos">
                    {van.slice(0, 7).map((j: any) => <Avatar key={j.id} p={j} size={28} />)}
                    {van.length > 7 && <span className="avatar mas" style={{ width: 28, height: 28 }}>+{van.length - 7}</span>}
                  </span>
                  <span className="mut">{voy === 0 ? 'Nadie apuntado todavía' : `${voy} ${voy === 1 ? 'va' : 'van'}`}</span>
                </div>
              )
            })()}
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
              <div className="aviso equipo-aviso">
                {(() => {
                  const c = color(miEq.equipo === 'A' ? prox.color_a : prox.color_b)
                  return c
                    ? <><span className="camiseta grande" style={{ ['--m' as any]: c.hex }} /><span>Equipos listos: juegas con los <b>{c.plural.toLowerCase()}</b>. ¡Lleva camiseta {c.nombre.toLowerCase()}!</span></>
                    : <span>⚽ Equipos listos: juegas en el <b>equipo {miEq.equipo}</b></span>
                })()}
              </div>
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
            <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
              <button className="sec" style={{ flex: 1 }} onClick={() => onPartido(prox.id)}>Ver detalle</button>
              {!empezado && <button className="sec ico" onClick={() => anadirCalendario(prox)} aria-label="Añadir al calendario" title="Añadir al calendario">🗓️</button>}
            </div>
          </div>
        )
      })() : (
        <div className="hero">
          <div className="vacio" style={{ padding: '14px 0' }}><span>🗓️</span><b>No hay ningún partido convocado</b><div className="mut">Cuando el admin cree uno, aparecerá aquí.</div></div>
        </div>
      )}

      {bannerAvisos && <TarjetaAvisos compacta onCerrar={cerrarBanner} />}

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

      {ultimo && (() => {
        const mi = d.part.find((x: any) => x.partido_id === ultimo.id && x.jugador_id === yo.id)
        let res = ''
        if (mi) {
          const gf = mi.equipo === 'A' ? ultimo.goles_a : ultimo.goles_b
          const gc = mi.equipo === 'A' ? ultimo.goles_b : ultimo.goles_a
          res = gf > gc ? 'V' : gf < gc ? 'D' : 'E'
        }
        return (
          <div className="card" style={{ cursor: 'pointer' }} onClick={() => onPartido(ultimo.id)}>
            <div className="row">
              <span className="mut" style={{ flex: 1 }}>Último resultado · {fmt(ultimo.fecha)}</span>
              {res && <span className={'chip ' + res}>{res}</span>}
            </div>
            <div className="marcador sin-caja">
              <div className="marcador-eq">{color(ultimo.color_a) ? <><span className="camiseta grande" style={{ ['--m' as any]: color(ultimo.color_a)!.hex }} /><b className="pequeno">{color(ultimo.color_a)!.plural}</b></> : <><span className="mut">Equipo</span><b>A</b></>}</div>
              <div className="marcador-num">{ultimo.goles_a}<i>–</i>{ultimo.goles_b}</div>
              <div className="marcador-eq">{color(ultimo.color_b) ? <><span className="camiseta grande" style={{ ['--m' as any]: color(ultimo.color_b)!.hex }} /><b className="pequeno">{color(ultimo.color_b)!.plural}</b></> : <><span className="mut">Equipo</span><b>B</b></>}</div>
            </div>
            <div className="mut" style={{ textAlign: 'center' }}>{mi ? (color(mi.equipo === 'A' ? ultimo.color_a : ultimo.color_b) ? `Jugaste con los ${nombreEquipo(mi.equipo, mi.equipo === 'A' ? ultimo.color_a : ultimo.color_b).toLowerCase()} · ` : `Jugaste en el equipo ${mi.equipo} · `) : ''}Ver detalle ›</div>
          </div>
        )
      })()}

      {d.yoStats && d.yoStats.partidos > 0 && (
        <>
          <h2>Tus números</h2>
          <div className="grid3">
            <div className="tile"><b><Numero v={d.yoStats.partidos} /></b><span className="mut">Partidos</span></div>
            <div className="tile"><b><Numero v={pct} sufijo="%" /></b><span className="mut">Victorias</span></div>
            <div className="tile"><b><Numero v={d.yoStats.mvps} /></b><span className="mut">MVP</span></div>
            <div className="tile"><b><Numero v={d.yoStats.goles} /></b><span className="mut">Goles</span></div>
            <div className="tile"><b><Numero v={d.yoStats.asistencias} /></b><span className="mut">Asistencias</span></div>
          </div>
        </>
      )}
    </>
  )
}
