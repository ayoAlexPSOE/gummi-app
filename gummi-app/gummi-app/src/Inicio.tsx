import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { aviso } from './dialogos'
import { configuracion, perfilesActivos, ranking } from './datos'
import { color, nombreEquipo } from './equipos'
import { TarjetaAvisos } from './push'
import { fecha, horario, convocados, respuestaLocal, PLAZAS_DEFECTO } from './util'
import Numero from './Numero'
import Avatar from './Avatar'
import { Cargando, anadirCalendario, vibra } from './movil'
import OnceIdeal from './OnceIdeal'

const esPC = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1000px)').matches

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
      configuracion(),
      ranking(),
      perfilesActivos(),
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
      rk: rk.data || [],
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
    setD((x: any) => ({ ...x, conv: respuestaLocal(x.conv, partido_id, yo.id, respuesta) }))
    const { error } = await supabase.from('convocatorias').upsert(
      { partido_id, jugador_id: yo.id, respuesta, updated_at: new Date().toISOString() },
      { onConflict: 'partido_id,jugador_id' }
    )
    if (error) aviso(error.message, 'error')
    else cargar()
  }

  const fmt = (iso: string) => fecha(iso, 'corta')

  const pct = d.yoStats && d.yoStats.partidos > 0 ? Math.round((100 * d.yoStats.victorias) / d.yoStats.partidos) : null

  const pc = esPC()
  const top = [...(d.rk || [])].filter((r: any) => r.goles > 0).sort((a: any, b: any) => b.goles - a.goles || b.asistencias - a.asistencias).slice(0, 5)
  const perfilDe = (id: string) => d.perfiles.find((j: any) => j.id === id)
  return (
    <div className="inicio">
    <div className="inicio-izq">
      {prox ? (() => {
        const mia = d.conv.find((c: any) => c.partido_id === prox.id && c.jugador_id === yo.id)
        const { titulares, reservas } = convocados(d.conv, prox.id, d.cfg?.plazas ?? PLAZAS_DEFECTO)
        const voy = titulares.length
        const miReserva = reservas.indexOf(yo.id)
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
              const van = titulares.map((jid: string) => d.perfiles.find((j: any) => j.id === jid)).filter(Boolean)
              return (
                <div className="pila" onClick={() => onPartido(prox.id)}>
                  <span className="pila-fotos">
                    {van.slice(0, 7).map((j: any) => <Avatar key={j.id} p={j} size={28} />)}
                    {van.length > 7 && <span className="avatar mas" style={{ width: 28, height: 28 }}>+{van.length - 7}</span>}
                  </span>
                  <span className="mut">{voy === 0 ? 'Nadie apuntado todavía' : `${voy} ${voy === 1 ? 'va' : 'van'}`}{reservas.length > 0 ? ` · ${reservas.length} de reserva` : ''}</span>
                </div>
              )
            })()}
            {miReserva >= 0 && (
              <div className="aviso reserva-aviso">🕓 Estás de <b>reserva nº {miReserva + 1}</b>. Si alguien se borra, entras tú y te avisamos.</div>
            )}
            {empezado ? (
              <div className="mut my10">En juego ahora</div>
            ) : (
              <div className="cuenta">
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
              <div className="respuesta">
                {OPCIONES.map(([v, t, ic]) => (
                  <button key={v} className={'resp-' + v + (mia?.respuesta === v ? ' sel' : ' sec')} onClick={() => responder(prox.id, v)} aria-pressed={mia?.respuesta === v}>
                    <span>{ic}</span>{t}
                  </button>
                ))}
              </div>
            )}
            <div className="row hero-pie">
              <button className="sec f1" onClick={() => onPartido(prox.id)}>Ver detalle</button>
              {!empezado && <button className="sec ico" onClick={() => anadirCalendario(prox)} aria-label="Añadir al calendario" title="Añadir al calendario">🗓️</button>}
            </div>
          </div>
        )
      })() : (
        <div className="hero">
          <div className="vacio" style={{ padding: '14px 0' }}><span>🗓️</span><b>No hay ningún partido convocado</b><div className="mut">Cuando el admin cree uno, aparecerá aquí.</div></div>
        </div>
      )}

      {proximos.length > 1 && (
        <>
          <h2>Más adelante</h2>
          <div className="card mas-partidos">
            {proximos.slice(1).map((p: any) => {
              const mia = d.conv.find((x: any) => x.partido_id === p.id && x.jugador_id === yo.id)
              const { titulares } = convocados(d.conv, p.id, d.cfg?.plazas ?? PLAZAS_DEFECTO)
              return (
                <div key={p.id} className="partido-mini" onClick={() => onPartido(p.id)}>
                  <span className="pm-dia">
                    <b>{horario(p)}</b>
                    <span className="mut">{[p.lugar, `${titulares.length} ${titulares.length === 1 ? 'va' : 'van'}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  {p.estado === 'convocatoria' && (
                    <span className="seg" onClick={(e) => e.stopPropagation()}>
                      {OPCIONES.map(([v, t, ic]) => (
                        <button key={v} className={mia?.respuesta === v ? 'on' : ''} onClick={() => responder(p.id, v)} aria-pressed={mia?.respuesta === v} aria-label={t}>{ic}</button>
                      ))}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </>
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
          <div className="card clic" onClick={() => onPartido(ultimo.id)}>
            <div className="row">
              <span className="mut f1">Último resultado · {fmt(ultimo.fecha)}</span>
              {res && <span className={'chip ' + res}>{res}</span>}
            </div>
            <div className="marcador sin-caja">
              <div className="marcador-eq">{color(ultimo.color_a) ? <><span className="camiseta grande" style={{ ['--m' as any]: color(ultimo.color_a)!.hex }} /><b className="pequeno">{color(ultimo.color_a)!.plural}</b></> : <><span className="mut">Equipo</span><b>A</b></>}</div>
              <div className="marcador-num">{ultimo.goles_a}<i>–</i>{ultimo.goles_b}</div>
              <div className="marcador-eq">{color(ultimo.color_b) ? <><span className="camiseta grande" style={{ ['--m' as any]: color(ultimo.color_b)!.hex }} /><b className="pequeno">{color(ultimo.color_b)!.plural}</b></> : <><span className="mut">Equipo</span><b>B</b></>}</div>
            </div>
            <div className="mut centro">{mi ? (color(mi.equipo === 'A' ? ultimo.color_a : ultimo.color_b) ? `Jugaste con los ${nombreEquipo(mi.equipo, mi.equipo === 'A' ? ultimo.color_a : ultimo.color_b).toLowerCase()} · ` : `Jugaste en el equipo ${mi.equipo} · `) : ''}Ver detalle ›</div>
          </div>
        )
      })()}

    </div>
    <div className="inicio-der">
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
      {/* Solo en PC: hay sitio para el top y el once ideal sin cambiar de pestaña */}
      {pc && top.length > 0 && (
        <>
          <h2>Goleadores</h2>
          <div className="card top-inicio">
            {top.map((r: any, i: number) => (
              <div key={r.jugador_id} className={'top-fila' + (r.jugador_id === yo.id ? ' yo' : '')}>
                <span className="top-pos">{['🥇', '🥈', '🥉'][i] || i + 1}</span>
                <Avatar p={perfilDe(r.jugador_id)} size={28} />
                <span className="f1 min0">{perfilDe(r.jugador_id)?.apodo || perfilDe(r.jugador_id)?.nombre || '?'}</span>
                <b>{r.goles}</b><span className="mut fs12">goles</span>
              </div>
            ))}
          </div>
        </>
      )}
      {pc && <OnceIdeal perfiles={d.perfiles} onFicha={() => {}} />}
    </div>
    </div>
  )
}
