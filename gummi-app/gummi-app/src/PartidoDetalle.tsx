import { useEffect, useState } from 'react'
import { supabase } from './supabase'

type Eq = 'A' | 'B'

const ESTADOS: Record<string, string> = {
  convocatoria: 'Convocatoria',
  equipos: 'Equipos',
  jugado: 'Jugado',
  cerrado: 'Cerrado',
}
const POSICIONES = ['defensa', 'medio', 'delantero']
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
    const posA = [0, 0, 0]
    const posB = [0, 0, 0]
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
    for (let k = 0; k < 3; k++) coste += 0.08 * Math.abs(posA[k] - posB[k])
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

  const cargar = async () => {
    const [pp, pr, cv, pa, ev] = await Promise.all([
      supabase.from('partidos').select('*').eq('id', id).single(),
      supabase.from('perfiles').select('*').eq('activo', true).order('nombre'),
      supabase.from('convocatorias').select('*').eq('partido_id', id),
      supabase.from('participaciones').select('*').eq('partido_id', id),
      supabase.from('eventos').select('*').eq('partido_id', id),
    ])
    setP(pp.data)
    setPerfiles(pr.data || [])
    setConv(cv.data || [])
    setPart(pa.data || [])
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

  if (!p) return <p className="c">Cargando…</p>

  const nombre = (jid: string) => {
    const j = perfiles.find((x) => x.id === jid)
    return j ? j.apodo || j.nombre : '?'
  }
  const notaDe = (jid: string) => (notas[jid]?.nota != null ? Number(notas[jid].nota) : NOTA_DEFECTO)
  const media = (ids: string[]) =>
    ids.length ? (ids.reduce((s, i) => s + notaDe(i), 0) / ids.length).toFixed(1) : '–'
  const respDe = (jid: string) => conv.find((c) => c.jugador_id === jid)?.respuesta || ''
  const golesDe = (jid: string, tipo: string) =>
    eventos.filter((e) => e.jugador_id === jid && e.tipo === tipo).length

  const recargarConv = async () => {
    const r = await supabase.from('convocatorias').select('*').eq('partido_id', id)
    setConv(r.data || [])
  }

  const setResp = async (jugador_id: string, respuesta: string) => {
    if (!respuesta) {
      const { error } = await supabase
        .from('convocatorias').delete().eq('partido_id', id).eq('jugador_id', jugador_id)
      if (error) return alert(error.message)
    } else {
      const { error } = await supabase.from('convocatorias').upsert(
        { partido_id: id, jugador_id, respuesta, updated_at: new Date().toISOString() },
        { onConflict: 'partido_id,jugador_id' }
      )
      if (error) return alert(error.message)
    }
    recargarConv()
  }

  // ---------- equipos ----------
  const confirmados = perfiles.filter((j) => respDe(j.id) === 'voy')

  const generar = () => {
    if (confirmados.length < 2) return alert('Hacen falta al menos 2 jugadores con "Voy".')
    if (confirmados.length > 20) return alert('Demasiados jugadores para repartir (máximo 20).')
    setBorrador(generarEquipos(confirmados, notaDe))
  }

  const mover = (jid: string) => {
    if (!borrador) return
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
    if (del.error) { setBusy(false); return alert(del.error.message) }
    const ins = await supabase.from('participaciones').insert(filas)
    if (ins.error) { setBusy(false); return alert(ins.error.message) }
    if (p.estado === 'convocatoria') {
      await supabase.from('partidos').update({ estado: 'equipos' }).eq('id', id)
    }
    setBorrador(null)
    await cargar()
    setBusy(false)
  }

  // ---------- resultado, goles y asistencias ----------
  const ajustar = (jid: string, campo: 'g' | 'a', delta: number) => {
    const actual = cont[jid] || { g: 0, a: 0 }
    setCont({ ...cont, [jid]: { ...actual, [campo]: Math.max(0, actual[campo] + delta) } })
  }

  const guardarResultado = async () => {
    if (p.estado !== 'jugado' &&
        !confirm('¿Cerrar el partido? Se abrirá la votación durante 48 horas.')) return
    setBusy(true)
    const filas: any[] = []
    for (const x of part) {
      const c = cont[x.jugador_id]
      if (!c) continue
      for (let i = 0; i < c.g; i++) filas.push({ partido_id: id, jugador_id: x.jugador_id, tipo: 'gol' })
      for (let i = 0; i < c.a; i++) filas.push({ partido_id: id, jugador_id: x.jugador_id, tipo: 'asistencia' })
    }
    const del = await supabase.from('eventos').delete().eq('partido_id', id)
    if (del.error) { setBusy(false); return alert(del.error.message) }
    if (filas.length) {
      const ins = await supabase.from('eventos').insert(filas)
      if (ins.error) { setBusy(false); return alert(ins.error.message) }
    }
    const upd = await supabase.from('partidos')
      .update({ goles_a: Number(ga) || 0, goles_b: Number(gb) || 0, estado: 'jugado' })
      .eq('id', id)
    if (upd.error) { setBusy(false); return alert(upd.error.message) }
    setEditando(false)
    await cargar()
    setBusy(false)
  }

  const borrar = async () => {
    if (!confirm('¿Borrar este partido y todo lo asociado? No se puede deshacer.')) return
    const { error } = await supabase.from('partidos').delete().eq('id', id)
    if (error) return alert(error.message)
    onBack()
  }

  // ---------- pintado ----------
  const puedeEditarEquipos = admin && (p.estado === 'convocatoria' || p.estado === 'equipos')
  const mostrarEditor = admin && part.length > 0 && (p.estado === 'equipos' || (p.estado === 'jugado' && editando))
  const jugado = p.estado === 'jugado' || p.estado === 'cerrado'

  const renderEquipo = (letra: Eq, ids: string[], editable: boolean) => (
    <div className="card" key={letra}>
      <div className="row">
        <b style={{ flex: 1 }}>Equipo {letra}</b>
        <span className="mut">
          {ids.length}{admin ? ` · media ${media(ids)}` : ''}
        </span>
      </div>
      {ids.map((jid) => (
        <div
          key={jid}
          className="fila"
          onClick={editable ? () => mover(jid) : undefined}
          style={{ cursor: editable ? 'pointer' : 'default' }}
        >
          <span>{nombre(jid)}</span>
          <span className="mut">
            {admin && !jugado && (notas[jid]?.nota ?? '–')}
            {jugado && golesDe(jid, 'gol') > 0 && ` ⚽${golesDe(jid, 'gol')}`}
            {jugado && golesDe(jid, 'asistencia') > 0 && ` 🅰️${golesDe(jid, 'asistencia')}`}
          </span>
        </div>
      ))}
    </div>
  )

  const idsGuardados = (eq: Eq) => part.filter((x) => x.equipo === eq).map((x) => x.jugador_id)
  const idsBorrador = (eq: Eq) =>
    Object.keys(borrador || {}).filter((k) => (borrador as any)[k] === eq)

  return (
    <>
      <div className="row" style={{ margin: '12px 0' }}>
        <button className="sec mini" onClick={onBack}>← Volver</button>
        <span className="tag">{ESTADOS[p.estado]}</span>
      </div>
      <h2 style={{ marginTop: 0 }}>
        {new Date(p.fecha).toLocaleString('es-ES', {
          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        })}
      </h2>
      <div className="mut">{p.lugar || 'Sin lugar'}</div>

      {jugado && p.goles_a != null && (
        <div className="card c" style={{ padding: '18px 0' }}>
          <div className="mut">Resultado</div>
          <div style={{ fontSize: 34, fontWeight: 700 }}>{p.goles_a} - {p.goles_b}</div>
        </div>
      )}

      {/* ---- Equipos ---- */}
      {(borrador || part.length > 0 || puedeEditarEquipos) && <h2>Equipos</h2>}
      {borrador ? (
        <>
          <p className="mut">Toca un jugador para pasarlo al otro equipo.</p>
          {renderEquipo('A', idsBorrador('A'), true)}
          {renderEquipo('B', idsBorrador('B'), true)}
          <div className="row">
            <button className="sec" onClick={generar}>Regenerar</button>
            <button className="sec" onClick={() => setBorrador(null)}>Cancelar</button>
            <button disabled={busy} onClick={guardarEquipos}>Guardar equipos</button>
          </div>
        </>
      ) : (
        <>
          {part.length > 0 && (
            <>
              {renderEquipo('A', idsGuardados('A'), false)}
              {renderEquipo('B', idsGuardados('B'), false)}
            </>
          )}
          {puedeEditarEquipos && (
            <button onClick={generar}>
              {part.length > 0 ? 'Rehacer equipos' : `Generar equipos (${confirmados.length} confirmados)`}
            </button>
          )}
          {part.length === 0 && !puedeEditarEquipos && (
            <p className="mut">Los equipos todavía no están hechos.</p>
          )}
        </>
      )}

      {/* ---- Convocatoria ---- */}
      {(p.estado === 'convocatoria' || p.estado === 'equipos') && (
        <>
          <h2>Convocatoria · {confirmados.length} van</h2>
          {!admin && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                {[['voy', 'Voy'], ['duda', 'Duda'], ['no_voy', 'No voy']].map(([v, t]) => (
                  <button key={v} className={'sec' + (respDe(yo.id) === v ? ' on2' : '')}
                    onClick={() => setResp(yo.id, v)}>{t}</button>
                ))}
              </div>
              <div className="card">
                {['voy', 'duda', 'no_voy'].map((r) => {
                  const lista = perfiles.filter((j) => respDe(j.id) === r)
                  if (!lista.length) return null
                  return (
                    <div key={r} style={{ margin: '4px 0' }}>
                      <span className="tag">{r === 'voy' ? 'Van' : r === 'duda' ? 'Dudan' : 'No van'}</span>{' '}
                      {lista.map((j) => j.apodo || j.nombre).join(', ')}
                    </div>
                  )
                })}
              </div>
            </>
          )}
          {admin && (
            <div className="card">
              {perfiles.map((j) => (
                <div key={j.id} className="fila">
                  <span>
                    {j.apodo || j.nombre} {j.es_externo && <span className="tag">externo</span>}
                  </span>
                  <select value={respDe(j.id)} onChange={(e) => setResp(j.id, e.target.value)}>
                    <option value="">—</option>
                    <option value="voy">Voy</option>
                    <option value="duda">Duda</option>
                    <option value="no_voy">No voy</option>
                  </select>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---- Resultado, goles y asistencias ---- */}
      {mostrarEditor && (
        <>
          <h2>Resultado, goles y asistencias</h2>
          <p className="mut">Apúntalos después del partido.</p>
          <div className="card">
            {part.map((x) => {
              const c = cont[x.jugador_id] || { g: 0, a: 0 }
              return (
                <div key={x.jugador_id} className="fila">
                  <span>{nombre(x.jugador_id)} <span className="tag">{x.equipo}</span></span>
                  <span className="row" style={{ gap: 4 }}>
                    <button className="sec mini" onClick={() => ajustar(x.jugador_id, 'g', -1)}>−</button>
                    <span>⚽ {c.g}</span>
                    <button className="sec mini" onClick={() => ajustar(x.jugador_id, 'g', 1)}>+</button>
                    <span style={{ width: 8 }} />
                    <button className="sec mini" onClick={() => ajustar(x.jugador_id, 'a', -1)}>−</button>
                    <span>🅰️ {c.a}</span>
                    <button className="sec mini" onClick={() => ajustar(x.jugador_id, 'a', 1)}>+</button>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="row" style={{ justifyContent: 'center', margin: '12px 0' }}>
            <b>A</b>
            <input type="number" min={0} style={{ width: 70, textAlign: 'center' }} value={ga}
              onChange={(e) => { setManual(true); setGa(e.target.value) }} />
            <b>–</b>
            <input type="number" min={0} style={{ width: 70, textAlign: 'center' }} value={gb}
              onChange={(e) => { setManual(true); setGb(e.target.value) }} />
            <b>B</b>
          </div>
          <p className="mut">El marcador se suma solo con los goles. Si hubo un gol en propia puerta, corrígelo a mano.</p>
          <div className="row">
            {editando && <button className="sec" onClick={() => { setEditando(false); cargar() }}>Cancelar</button>}
            <button disabled={busy} onClick={guardarResultado}>
              {p.estado === 'jugado' ? 'Guardar cambios' : 'Guardar y cerrar partido'}
            </button>
          </div>
        </>
      )}

      {admin && p.estado === 'jugado' && !editando && part.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button className="sec" onClick={() => setEditando(true)}>Editar resultado y goles</button>
        </div>
      )}

      {admin && (
        <div style={{ marginTop: 28 }}>
          <button className="sec" onClick={borrar}>Borrar partido</button>
        </div>
      )}
    </>
  )
}
