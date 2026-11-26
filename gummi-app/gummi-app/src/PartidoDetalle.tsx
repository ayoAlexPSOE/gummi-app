import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { aviso, confirmar } from './dialogos'
import { configuracion, invalidar, perfilesActivos } from './datos'
import { ESTADOS, horario, convocados, respuestaLocal, PLAZAS_DEFECTO } from './util'
import HorarioPicker, { Horario, aTimestamps, desdePartido } from './HorarioPicker'
import Avatar from './Avatar'
import { Cargando, anadirCalendario, compartir, vibra } from './movil'
import { COLORES, color, elegirColores, nombreEquipo, seParecen } from './equipos'
import { compartirImagen } from './imagen'

type Eq = 'A' | 'B'

const POSICIONES = ['defensa', 'medio', 'banda', 'delantero']
const NOTA_DEFECTO = 5

// Reparte a los jugadores en dos equipos lo más igualados posible
// (por nota y, en segundo lugar, por posición). Elige al azar entre las
// mejores combinaciones para que "Regenerar" dé propuestas distintas.
function generarEquipos(jug: any[], notaDe: (id: string) => number): Record<string, Eq> {
  const n = jug.length
  const res: Record<string, Eq> = {}
  if (n < 2) {
    for (const j of jug) res[j.id] = 'A'
    return res
  }
  const tamA = Math.floor(n / 2)
  const tamB = n - tamA
  const notas = jug.map((j) => notaDe(j.id))
  const esPortero = jug.map((j) => j.posicion === 'portero')
  const totalPorteros = esPortero.filter(Boolean).length
  const pos = jug.map((j) => POSICIONES.indexOf(j.posicion))
  const candidatos: { mask: number; coste: number }[] = []
  const limite = 1 << n

  for (let mask = 0; mask < limite; mask++) {
    if (n % 2 === 0 && !(mask & 1)) continue // evita duplicados A/B
    let cuenta = 0
    let sumA = 0
    let sumB = 0
    let porA = 0
    let porB = 0
    const posA = [0, 0, 0, 0]
    const posB = [0, 0, 0, 0]
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        cuenta++
        sumA += notas[i]
        if (esPortero[i]) porA++
        if (pos[i] >= 0) posA[pos[i]]++
      } else {
        sumB += notas[i]
        if (esPortero[i]) porB++
        if (pos[i] >= 0) posB[pos[i]]++
      }
    }
    if (cuenta !== tamA) continue
    let coste = Math.abs(sumA / tamA - sumB / tamB)
    if (totalPorteros >= 2) coste += 3 * Math.abs(porA - porB)
    for (let k = 0; k < 4; k++) coste += 0.08 * Math.abs(posA[k] - posB[k])
    candidatos.push({ mask, coste })
  }

  candidatos.sort((a, b) => a.coste - b.coste)
  const mejor = candidatos[0].coste
  const buenos = candidatos.filter((c) => c.coste <= mejor + 0.2).slice(0, 30)
  const elegido = buenos[Math.floor(Math.random() * buenos.length)]
  const invertir = Math.random() < 0.5
  jug.forEach((j, i) => {
    const enA = (elegido.mask & (1 << i)) !== 0
    res[j.id] = enA !== invertir ? 'A' : 'B'
  })
  return res
}


export default function PartidoDetalle({ id, yo, onBack }: { id: number; yo: any; onBack: () => void }) {
  const admin = yo.rol === 'admin'
  const [p, setP] = useState<any>(null)
  const [perfiles, setPerfiles] = useState<any[]>([])
  const [conv, setConv] = useState<any[]>([])
  const [part, setPart] = useState<any[]>([])
  const [eventos, setEventos] = useState<any[]>([])
  const [notas, setNotas] = useState<Record<string, any>>({})
  const [borrador, setBorrador] = useState<Record<string, Eq> | null>(null)
  const [editando, setEditando] = useState(false)
  const [cont, setCont] = useState<Record<string, { g: number; a: number }>>({})
  const [ga, setGa] = useState('')
  const [gb, setGb] = useState('')
  const [manual, setManual] = useState(false)
  const [busy, setBusy] = useState(false)
  const [colores, setColores] = useState<[string, string] | null>(null) // colores en el borrador
  const [editDatos, setEditDatos] = useState<{ hor: Horario; lugar: string } | null>(null)
  const [mvp, setMvp] = useState<any[]>([])
  const [plazas, setPlazas] = useState(PLAZAS_DEFECTO)
  const [haciendoImg, setHaciendoImg] = useState(false)

  const cargar = async () => {
    const [pp, pr, cv, pa, ev] = await Promise.all([
      supabase.from('partidos').select('*').eq('id', id).single(),
      perfilesActivos(),
      supabase.from('convocatorias').select('*').eq('partido_id', id),
      supabase.from('participaciones').select('*').eq('partido_id', id),
      supabase.from('eventos').select('*').eq('partido_id', id),
    ])
    setP(pp.data)
    setPerfiles(pr.data || [])
    setConv(cv.data || [])
    setPart(pa.data || [])
    configuracion().then((cf) => { if (!cf.error && cf.data?.plazas) setPlazas(cf.data.plazas) })
    setEventos(ev.data || [])

    const c: Record<string, { g: number; a: number }> = {}
    for (const x of pa.data || []) c[x.jugador_id] = { g: 0, a: 0 }
    for (const e of ev.data || []) {
      if (c[e.jugador_id]) c[e.jugador_id][e.tipo === 'gol' ? 'g' : 'a']++
    }
    setCont(c)
    setManual(pp.data?.goles_a != null)
    setGa(pp.data?.goles_a != null ? String(pp.data.goles_a) : '')
    setGb(pp.data?.goles_b != null ? String(pp.data.goles_b) : '')

    // El MVP solo se muestra cuando ha terminado la ventana de votación.
    if (pp.data?.votacion_hasta && new Date(pp.data.votacion_hasta).getTime() < Date.now()) {
      const m = await supabase.rpc('mvp_resultado', { p_partido: id })
      setMvp(m.error ? [] : m.data || [])
    } else {
      setMvp([])
    }

    if (admin) {
      const n = await supabase.rpc('notas_jugadores')
      if (!n.error) {
        const m: Record<string, any> = {}
        for (const r of n.data || []) m[r.jugador_id] = r
        setNotas(m)
      }
    }
  }
  useEffect(() => { cargar() }, [id])

  // El marcador se calcula solo a partir de los goles, hasta que se edite a mano.
  useEffect(() => {
    if (manual) return
    let a = 0
    let b = 0
    for (const x of part) {
      const g = cont[x.jugador_id]?.g || 0
      if (x.equipo === 'A') a += g
      else b += g
    }
    setGa(String(a))
    setGb(String(b))
  }, [cont, manual, part])

  if (!p) return <Cargando />

  const perfilDe = (jid: string) => perfiles.find((x) => x.id === jid)
  const nombre = (jid: string) => {
    const j = perfilDe(jid)
    return j ? j.apodo || j.nombre : '?'
  }
  // El generador trabaja en escala 1-10; las medias vienen de 0 a 99.
  const notaDe = (jid: string) => (notas[jid]?.nota != null ? Number(notas[jid].nota) / 10 : NOTA_DEFECTO)
  const media = (ids: string[]) =>
    ids.length ? Math.round((10 * ids.reduce((s, i) => s + notaDe(i), 0)) / ids.length) : '–'
  const respDe = (jid: string) => conv.find((c) => c.jugador_id === jid)?.respuesta || ''
  const golesDe = (jid: string, tipo: string) =>
    eventos.filter((e) => e.jugador_id === jid && e.tipo === tipo).length

  const recargarConv = async () => {
    const r = await supabase.from('convocatorias').select('*').eq('partido_id', id)
    setConv(r.data || [])
  }

  const setResp = async (jugador_id: string, respuesta: string) => {
    vibra()
    setConv((cs) => respuestaLocal(cs, id, jugador_id, respuesta))
    if (!respuesta) {
      const { error } = await supabase
        .from('convocatorias').delete().eq('partido_id', id).eq('jugador_id', jugador_id)
      if (error) return aviso(error.message, 'error')
    } else {
      const { error } = await supabase.from('convocatorias').upsert(
        { partido_id: id, jugador_id, respuesta, updated_at: new Date().toISOString() },
        { onConflict: 'partido_id,jugador_id' }
      )
      if (error) return aviso(error.message, 'error')
    }
    recargarConv()
  }

  // ---------- equipos ----------
  // Juegan los primeros en apuntarse hasta llenar las plazas; el resto, de reserva
  const { titulares, reservas } = convocados(conv, id, plazas)
  const confirmados = titulares.map((jid) => perfilDe(jid)).filter(Boolean) as any[]
  const reservaDe = (jid: string) => reservas.indexOf(jid)

  const generar = () => {
    if (confirmados.length < 2) return aviso('Hacen falta al menos 2 jugadores con "Voy".')
    if (confirmados.length > 20) return aviso('Demasiados jugadores para repartir (máximo 20).')
    vibra(20)
    // Si el partido ya tiene colores se mantienen; si no, se eligen solos.
    if (!colores) setColores(p.color_a && p.color_b ? [p.color_a, p.color_b] : elegirColores())
    setBorrador(generarEquipos(confirmados, notaDe))
    setTimeout(() => document.getElementById('equipos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const mover = (jid: string) => {
    if (!borrador) return
    vibra(8)
    setBorrador({ ...borrador, [jid]: borrador[jid] === 'A' ? 'B' : 'A' })
  }

  const guardarEquipos = async () => {
    if (!borrador) return
    setBusy(true)
    const filas = Object.entries(borrador).map(([jid, eq]) => ({
      partido_id: id,
      jugador_id: jid,
      equipo: eq,
      posicion: perfiles.find((x) => x.id === jid)?.posicion ?? null,
    }))
    const del = await supabase.from('participaciones').delete().eq('partido_id', id)
    if (del.error) { setBusy(false); return aviso(del.error.message, 'error') }
    const ins = await supabase.from('participaciones').insert(filas)
    if (ins.error) { setBusy(false); return aviso(ins.error.message, 'error') }
    const cambios: any = p.estado === 'convocatoria' ? { estado: 'equipos' } : {}
    if (colores) { cambios.color_a = colores[0]; cambios.color_b = colores[1] }
    if (Object.keys(cambios).length) {
      const u = await supabase.from('partidos').update(cambios).eq('id', id)
      // Sin el script 14 todavía: se guarda sin colores
      if (u.error && /color_/.test(u.error.message) && cambios.estado) await supabase.from('partidos').update({ estado: 'equipos' }).eq('id', id)
    }
    vibra(25)
    setBorrador(null)
    setColores(null)
    await cargar()
    setBusy(false)
  }

  // Colores de camiseta: en el borrador se guardan con los equipos; si ya están hechos, al momento.
  const colorDe = (eq: Eq): string | null => (colores ? colores[eq === 'A' ? 0 : 1] : eq === 'A' ? p.color_a : p.color_b) || null
  const cambiarColor = async (eq: Eq, nuevo: string) => {
    vibra(8)
    const otro = colorDe(eq === 'A' ? 'B' : 'A')
    let a = eq === 'A' ? nuevo : colorDe('A') || ''
    let b = eq === 'B' ? nuevo : colorDe('B') || ''
    // Si choca con el otro equipo, el otro pasa a un color que se distinga
    if (otro && seParecen(nuevo, otro)) {
      const alt = COLORES.find((x) => !seParecen(x.id, nuevo))!.id
      if (eq === 'A') b = alt; else a = alt
    }
    if (borrador) { setColores([a, b]); return }
    const u = await supabase.from('partidos').update({ color_a: a || null, color_b: b || null }).eq('id', id)
    if (u.error) return aviso(/color_/.test(u.error.message) ? 'Falta ejecutar en Supabase el script 14_banda_colores.sql.' : u.error.message, 'error')
    setP({ ...p, color_a: a || null, color_b: b || null })
  }
  const selectorColores = () => (
    <div className="card camisetas">
      <b>👕 Camisetas</b>
      {(['A', 'B'] as Eq[]).map((eq) => {
        const mio = colorDe(eq)
        const otro = colorDe(eq === 'A' ? 'B' : 'A')
        return (
          <div key={eq} className="camiseta-fila">
            <span className="mut">{nombreEquipo(eq, mio)}</span>
            <div className="muestras">
              {COLORES.map((x) => (
                <button key={x.id} type="button" className={'muestra' + (mio === x.id ? ' on' : '') + (otro && seParecen(x.id, otro) && mio !== x.id ? ' choca' : '')}
                  style={{ ['--m' as any]: x.hex }} onClick={() => cambiarColor(eq, x.id)} aria-label={x.nombre} title={x.nombre} />
              ))}
            </div>
          </div>
        )
      })}
      <div className="mut fs12">Tachado: se confunde con el color del otro equipo.</div>
    </div>
  )

  // ---------- resultado, goles y asistencias ----------
  const ajustar = (jid: string, campo: 'g' | 'a', delta: number) => {
    const actual = cont[jid] || { g: 0, a: 0 }
    setCont({ ...cont, [jid]: { ...actual, [campo]: Math.max(0, actual[campo] + delta) } })
  }

  const guardarResultado = async () => {
    if (p.estado !== 'jugado' &&
        !(await confirmar('¿Cerrar el partido? Se abrirá la votación durante 48 horas.', { si: 'Cerrar partido' }))) return
    setBusy(true)
    const filas: any[] = []
    for (const x of part) {
      const c = cont[x.jugador_id]
      if (!c) continue
      for (let i = 0; i < c.g; i++) filas.push({ partido_id: id, jugador_id: x.jugador_id, tipo: 'gol' })
      for (let i = 0; i < c.a; i++) filas.push({ partido_id: id, jugador_id: x.jugador_id, tipo: 'asistencia' })
    }
    const del = await supabase.from('eventos').delete().eq('partido_id', id)
    if (del.error) { setBusy(false); return aviso(del.error.message, 'error') }
    if (filas.length) {
      const ins = await supabase.from('eventos').insert(filas)
      if (ins.error) { setBusy(false); return aviso(ins.error.message, 'error') }
    }
    const upd = await supabase.from('partidos')
      .update({ goles_a: Number(ga) || 0, goles_b: Number(gb) || 0, estado: 'jugado' })
      .eq('id', id)
    if (upd.error) { setBusy(false); return aviso(upd.error.message, 'error') }
    setEditando(false)
    invalidar('ranking')
    try { await supabase.rpc('mantenimiento', { p_forzar: true }) } catch { /* sin SQL de avisos todavía */ }
    await cargar()
    setBusy(false)
  }

  const editarDatos = () => setEditDatos({ hor: desdePartido(p), lugar: p.lugar || '' })
  const guardarDatos = async () => {
    if (!editDatos || !editDatos.hor.fecha) return
    const t = aTimestamps(editDatos.hor)
    let r: any = await supabase.from('partidos')
      .update({ fecha: t.fecha, fecha_fin: t.fecha_fin, lugar: editDatos.lugar.trim() || null }).eq('id', id)
    if (r.error && /fecha_fin/.test(r.error.message)) {
      r = await supabase.from('partidos').update({ fecha: t.fecha, lugar: editDatos.lugar.trim() || null }).eq('id', id)
    }
    if (r.error) return aviso(r.error.message, 'error')
    setEditDatos(null)
    cargar()
  }

  const borrar = async () => {
    if (!(await confirmar('¿Borrar este partido y todo lo asociado? No se puede deshacer.', { si: 'Borrar', peligro: true }))) return
    const { error } = await supabase.from('partidos').delete().eq('id', id)
    if (error) return aviso(error.message, 'error')
    invalidar('ranking')
    onBack()
  }

  // ---------- imagen para compartir ----------
  const imagen = async () => {
    setHaciendoImg(true)
    const eq = (letra: Eq) => ({
      nombre: nombreEquipo(letra, colorDe(letra)),
      hex: color(colorDe(letra))?.hex || null,
      jugadores: idsGuardados(letra).map((jid) => ({ nombre: nombre(jid), g: golesDe(jid, 'gol'), a: golesDe(jid, 'asistencia') })),
    })
    try {
      await compartirImagen({
        modo: jugado && p.goles_a != null ? 'resultado' : 'equipos',
        fecha: horario(p, true).replace(/^./, (x: string) => x.toUpperCase()),
        lugar: p.lugar,
        a: eq('A'), b: eq('B'),
        golesA: p.goles_a, golesB: p.goles_b,
        mvp: mvp.length ? mvp.filter((m) => m.num_votos === mvp[0].num_votos).map((m) => nombre(m.jugador_id)).join(' y ') : null,
      }, `gummi-${p.id}.png`)
    } catch (e: any) { aviso(e?.message || 'No se pudo crear la imagen', 'error') }
    setHaciendoImg(false)
  }

  // ---------- compartir ----------
  const textoCompartir = () => {
    const cab = `⚽ Partido · ${horario(p, true)}${p.lugar ? ' · ' + p.lugar : ''}`
    const lista = (ids: string[]) => ids.map(nombre).join(', ')
    if (jugado && p.goles_a != null) {
      const goleadores = Object.entries(eventos.reduce((m: any, e: any) => {
        if (e.tipo === 'gol') m[e.jugador_id] = (m[e.jugador_id] || 0) + 1
        return m
      }, {})).map(([j, n]: any) => `${nombre(j)}${n > 1 ? ' ×' + n : ''}`).join(', ')
      return `${cab}\n🏁 ${nombreEquipo('A', p.color_a)} ${p.goles_a} – ${p.goles_b} ${nombreEquipo('B', p.color_b)}${goleadores ? '\n⚽ ' + goleadores : ''}${p.votacion_hasta && new Date(p.votacion_hasta).getTime() > Date.now() ? '\n🗳️ ¡Votación abierta 48 h!' : ''}`
    }
    if (part.length > 0) {
      const eqTxt = (eq: Eq) => `${color(colorDe(eq))?.emoji || (eq === 'A' ? '🅰️' : '🅱️')} ${nombreEquipo(eq, colorDe(eq))}: ${lista(idsGuardados(eq))}`
      return `${cab}\n${eqTxt('A')}\n${eqTxt('B')}`
    }
    const van = confirmados.map((j) => j.apodo || j.nombre)
    const dudan = perfiles.filter((j) => respDe(j.id) === 'duda').map((j) => j.apodo || j.nombre)
    const res = reservas.map((jid) => nombre(jid))
    return `${cab}\n✅ Van (${van.length}/${plazas}): ${van.join(', ') || 'nadie todavía'}${res.length ? `\n🕓 Reservas: ${res.join(', ')}` : ''}${dudan.length ? `\n🤔 Dudan: ${dudan.join(', ')}` : ''}\n¿Te apuntas?`
  }

  // ---------- pintado ----------
  const puedeEditarEquipos = admin && (p.estado === 'convocatoria' || p.estado === 'equipos')
  const mostrarEditor = admin && part.length > 0 && (p.estado === 'equipos' || (p.estado === 'jugado' && editando))
  const jugado = p.estado === 'jugado' || p.estado === 'cerrado'

  const renderEquipo = (letra: Eq, ids: string[], editable: boolean) => (
    <div className={'card equipo eq-' + letra} key={letra} style={color(colorDe(letra)) ? { ['--eq' as any]: color(colorDe(letra))!.ui } : undefined}>
      <div className="equipo-cab">
        <b>{color(colorDe(letra)) && <span className="camiseta" style={{ ['--m' as any]: color(colorDe(letra))!.hex }} />}{nombreEquipo(letra, colorDe(letra))}</b>
        <span className="mut">{ids.length}{admin && !jugado ? ` · ${media(ids)}` : ''}</span>
      </div>
      {ids.map((jid) => {
        const g = jugado ? golesDe(jid, 'gol') : 0
        const a = jugado ? golesDe(jid, 'asistencia') : 0
        return (
          <div key={jid} className={'eq-jug' + (editable ? ' movible' : '') + (jid === yo.id ? ' yo' : '')} onClick={editable ? () => mover(jid) : undefined}>
            <Avatar p={perfilDe(jid)} size={26} />
            <span className="eq-nombre">{nombre(jid)}</span>
            <span className="mut eq-dato">
              {admin && !jugado && (notas[jid]?.nota != null ? Math.round(Number(notas[jid].nota)) : '–')}
              {g > 0 && `⚽${g > 1 ? g : ''}`}
              {a > 0 && ` 🅰️${a > 1 ? a : ''}`}
            </span>
          </div>
        )
      })}
      {ids.length === 0 && <div className="mut">Nadie</div>}
    </div>
  )
  const idsGuardados = (eq: Eq) => part.filter((x) => x.equipo === eq).map((x) => x.jugador_id)
  const idsBorrador = (eq: Eq) =>
    Object.keys(borrador || {}).filter((k) => (borrador as any)[k] === eq)

  const proximo = !jugado && new Date(p.fecha_fin || p.fecha).getTime() > Date.now()
  const sinResponder = perfiles.filter((j) => !respDe(j.id) && !j.es_externo)
  const miResp = respDe(yo.id)

  return (
    <>
      <div className="row barra-detalle">
        <button className="sec mini" onClick={onBack}>← Volver</button>
        <span className={'tag estado-' + p.estado}>{ESTADOS[p.estado]}</span>
        <span className="f1" />
        {proximo && <button className="sec mini ico" onClick={() => anadirCalendario(p)} aria-label="Añadir al calendario" title="Añadir al calendario">🗓️</button>}
        {part.length > 0 && <button className="sec mini ico" disabled={haciendoImg} onClick={imagen} aria-label="Compartir imagen" title="Compartir imagen">🖼️</button>}
        <button className="sec mini ico" onClick={() => compartir(textoCompartir())} aria-label="Compartir texto" title="Compartir por WhatsApp">📤</button>
      </div>
      <h2 className="titulo-partido">{horario(p, true)}</h2>
      <div className="mut">
        📍 {p.lugar || 'Lugar por confirmar'}
        {admin && !editDatos && <button className="sec mini" style={{ marginLeft: 10 }} onClick={editarDatos}>Editar</button>}
      </div>
      {admin && editDatos && (
        <div className="card">
          <HorarioPicker valor={editDatos.hor} onChange={(hor) => setEditDatos({ ...editDatos, hor })} />
          <input className="mt8" placeholder="Lugar" value={editDatos.lugar} onChange={(e) => setEditDatos({ ...editDatos, lugar: e.target.value })} />
          <div className="row mt8">
            <button onClick={guardarDatos}>Guardar</button>
            <button className="sec" onClick={() => setEditDatos(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ---- Mi respuesta (jugadores) ---- */}
      {!admin && p.estado === 'convocatoria' && (
        <>
        <div className="respuesta mt14">
          {[['voy', 'Voy', '✅'], ['duda', 'Duda', '🤔'], ['no_voy', 'No voy', '❌']].map(([v, t, ic]) => (
            <button key={v} className={miResp === v ? 'sel' : 'sec'} onClick={() => setResp(yo.id, v)} aria-pressed={miResp === v}>
              <span>{ic}</span>{t}
            </button>
          ))}
        </div>
        {reservaDe(yo.id) >= 0 && <div className="aviso reserva-aviso">🕓 Estás de <b>reserva nº {reservaDe(yo.id) + 1}</b>. Si alguien se borra, entras tú y te avisamos.</div>}
        </>
      )}

      {puedeEditarEquipos && !borrador && (
        <button className="gen-equipos" onClick={generar}>
          ⚡ {part.length > 0 ? 'Rehacer equipos' : 'Generar equipos automáticos'}
          <span>{confirmados.length} {confirmados.length === 1 ? 'jugador va' : 'jugadores van'}{confirmados.length < 2 ? ' · marca antes quién va, más abajo' : ''}{reservas.length ? ` · ${reservas.length} de reserva` : ''}</span>
        </button>
      )}

      {jugado && p.goles_a != null && (
        <div className="marcador">
          <div className="marcador-eq" style={color(p.color_a) ? { ['--eq' as any]: color(p.color_a)!.ui } : undefined}>{color(p.color_a) ? <><span className="camiseta grande" style={{ ['--m' as any]: color(p.color_a)!.hex }} /><b className="pequeno">{color(p.color_a)!.plural}</b></> : <><span className="mut">Equipo</span><b>A</b></>}</div>
          <div className="marcador-num">{p.goles_a}<i>–</i>{p.goles_b}</div>
          <div className="marcador-eq" style={color(p.color_b) ? { ['--eq' as any]: color(p.color_b)!.ui } : undefined}>{color(p.color_b) ? <><span className="camiseta grande" style={{ ['--m' as any]: color(p.color_b)!.hex }} /><b className="pequeno">{color(p.color_b)!.plural}</b></> : <><span className="mut">Equipo</span><b>B</b></>}</div>
        </div>
      )}

      {jugado && mvp.length > 0 && (
        <div className="card mvp">
          <span className="mvp-corona">👑</span>
          <span className="f1">
            <div className="mut">MVP del partido</div>
            <b>{mvp.filter((m) => m.num_votos === mvp[0].num_votos).map((m) => nombre(m.jugador_id)).join(' y ')}</b>
          </span>
          <span className="mut">{mvp[0].num_votos} {mvp[0].num_votos === 1 ? 'voto' : 'votos'}</span>
        </div>
      )}
      {jugado && p.votacion_hasta && new Date(p.votacion_hasta).getTime() > Date.now() && (
        <div className="aviso">🗳️ Votación abierta hasta el {new Date(p.votacion_hasta).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Ve a la pestaña <b>Votar</b>.</div>
      )}

      {/* ---- Equipos ---- */}
      <div id="equipos" style={{ scrollMarginTop: 70 }} />
      {(borrador || part.length > 0) && <h2>Equipos</h2>}
      {borrador ? (
        <>
          <p className="mut">Toca un jugador para pasarlo al otro equipo.</p>
          <div className="equipos-grid">
            {renderEquipo('A', idsBorrador('A'), true)}
            {renderEquipo('B', idsBorrador('B'), true)}
          </div>
          {selectorColores()}
          <div className="grid3">
            <button className="sec" onClick={generar}>🔀 Otra</button>
            <button className="sec" onClick={() => { setBorrador(null); setColores(null) }}>Cancelar</button>
            <button disabled={busy} onClick={guardarEquipos}>Guardar</button>
          </div>
        </>
      ) : part.length > 0 ? (
        <>
          <div className="equipos-grid">
            {renderEquipo('A', idsGuardados('A'), false)}
            {renderEquipo('B', idsGuardados('B'), false)}
          </div>
          {admin && p.estado !== 'cerrado' && selectorColores()}
        </>
      ) : (
        !puedeEditarEquipos && (p.estado === 'convocatoria') && <p className="mut mt14">Los equipos se harán cuando se cierre la convocatoria.</p>
      )}

      {/* ---- Convocatoria ---- */}
      {(p.estado === 'convocatoria' || p.estado === 'equipos') && (
        <>
          <h2>Convocatoria · {confirmados.length}/{plazas}</h2>
          {!admin && (
            <div className="card">
              {[['voy', '✅ Van'], ['reserva', '🕓 Reservas (por orden)'], ['duda', '🤔 Dudan'], ['no_voy', '❌ No van']].map(([r, t]) => {
                const lista = r === 'voy' ? confirmados : r === 'reserva' ? (reservas.map((jid) => perfilDe(jid)).filter(Boolean) as any[]) : perfiles.filter((j) => respDe(j.id) === r)
                if (!lista.length) return null
                return (
                  <div key={r} className="conv-grupo">
                    <div className="mut">{t} ({lista.length})</div>
                    <div className="conv-lista">
                      {lista.map((j) => (
                        <span key={j.id} className={'conv-jug' + (j.id === yo.id ? ' yo' : '')}><Avatar p={j} size={22} />{r === 'reserva' ? `${reservaDe(j.id) + 1}. ` : ''}{j.apodo || j.nombre}</span>
                      ))}
                    </div>
                  </div>
                )
              })}
              {sinResponder.length > 0 && (
                <div className="conv-grupo">
                  <div className="mut">⏳ Sin responder ({sinResponder.length})</div>
                  <div className="mut fs12">{sinResponder.map((j) => j.apodo || j.nombre).join(', ')}</div>
                </div>
              )}
            </div>
          )}
          {admin && (
            <div className="card">
              <p className="mut mt0">Marca la respuesta de cada uno (vuelve a tocar para quitarla).</p>
              {perfiles.map((j) => {
                const r = respDe(j.id)
                return (
                  <div key={j.id} className="fila conv-admin">
                    <span className="conv-nombre">
                      <Avatar p={j} size={26} />
                      <span>{j.apodo || j.nombre}</span>
                      {j.es_externo && <span className="tag">ext</span>}
                      {reservaDe(j.id) >= 0 && <span className="tag tag-reserva" title="Reserva">R{reservaDe(j.id) + 1}</span>}
                    </span>
                    <span className="seg">
                      {[['voy', '✅'], ['duda', '🤔'], ['no_voy', '❌']].map(([v, ic]) => (
                        <button key={v} className={r === v ? 'on' : ''} onClick={() => setResp(j.id, r === v ? '' : v)} aria-pressed={r === v} aria-label={`${j.apodo || j.nombre}: ${v === 'voy' ? 'va' : v === 'duda' ? 'duda' : 'no va'}`}>{ic}</button>
                      ))}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ---- Resultado, goles y asistencias ---- */}
      {mostrarEditor && (
        <>
          <h2>Goles y asistencias</h2>
          <p className="mut">Apúntalos después del partido. El marcador se suma solo.</p>
          <div className="card">
            {(['A', 'B'] as Eq[]).map((eq) => (
              <div key={eq}>
                <div className="mut editor-eq">{nombreEquipo(eq, colorDe(eq))}</div>
                {part.filter((x) => x.equipo === eq).map((x) => {
                  const c = cont[x.jugador_id] || { g: 0, a: 0 }
                  return (
                    <div key={x.jugador_id} className="fila editor-fila">
                      <span className="conv-nombre"><Avatar p={perfilDe(x.jugador_id)} size={24} /><span>{nombre(x.jugador_id)}</span></span>
                      <span className="contador">
                        <button className="sec" onClick={() => ajustar(x.jugador_id, 'g', -1)} disabled={!c.g} aria-label="Quitar gol">−</button>
                        <span className={c.g ? 'on' : ''}>⚽{c.g}</span>
                        <button className="sec" onClick={() => { vibra(8); ajustar(x.jugador_id, 'g', 1) }} aria-label="Sumar gol">+</button>
                      </span>
                      <span className="contador">
                        <button className="sec" onClick={() => ajustar(x.jugador_id, 'a', -1)} disabled={!c.a} aria-label="Quitar asistencia">−</button>
                        <span className={c.a ? 'on' : ''}>🅰️{c.a}</span>
                        <button className="sec" onClick={() => { vibra(8); ajustar(x.jugador_id, 'a', 1) }} aria-label="Sumar asistencia">+</button>
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="marcador editable">
            <div className="marcador-eq" style={color(p.color_a) ? { ['--eq' as any]: color(p.color_a)!.ui } : undefined}>{color(p.color_a) ? <><span className="camiseta grande" style={{ ['--m' as any]: color(p.color_a)!.hex }} /><b className="pequeno">{color(p.color_a)!.plural}</b></> : <><span className="mut">Equipo</span><b>A</b></>}</div>
            <div className="marcador-num">
              <input type="number" inputMode="numeric" min={0} value={ga} onChange={(e) => { setManual(true); setGa(e.target.value) }} aria-label="Goles equipo A" />
              <i>–</i>
              <input type="number" inputMode="numeric" min={0} value={gb} onChange={(e) => { setManual(true); setGb(e.target.value) }} aria-label="Goles equipo B" />
            </div>
            <div className="marcador-eq" style={color(p.color_b) ? { ['--eq' as any]: color(p.color_b)!.ui } : undefined}>{color(p.color_b) ? <><span className="camiseta grande" style={{ ['--m' as any]: color(p.color_b)!.hex }} /><b className="pequeno">{color(p.color_b)!.plural}</b></> : <><span className="mut">Equipo</span><b>B</b></>}</div>
          </div>
          <p className="mut">Si hubo un gol en propia puerta, corrige el marcador a mano.</p>
          <div className="row">
            {editando && <button className="sec" onClick={() => { setEditando(false); cargar() }}>Cancelar</button>}
            <button className="f1" disabled={busy} onClick={guardarResultado}>
              {p.estado === 'jugado' ? 'Guardar cambios' : '🏁 Guardar y cerrar partido'}
            </button>
          </div>
        </>
      )}

      {admin && p.estado === 'jugado' && !editando && part.length > 0 && (
        <button className="sec w100 mt14" onClick={() => setEditando(true)}>✏️ Editar resultado y goles</button>
      )}

      {admin && (
        <button className="sec peligro w100 mt28" onClick={borrar}>🗑️ Borrar partido</button>
      )}
    </>
  )
}
