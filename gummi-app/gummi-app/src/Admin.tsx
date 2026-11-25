import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { horario } from './util'
import HorarioPicker, { Horario, horarioVacio, aTimestamps } from './HorarioPicker'

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const ESTADO: Record<string, string> = { convocatoria: 'Convocatoria', equipos: 'Equipos', jugado: 'Jugado', cerrado: 'Cerrado' }

export default function Admin({ yo, onBack, onPartido, onTab }: {
  yo: any
  onBack: () => void
  onPartido: (id: number) => void
  onTab: (tab: string) => void
}) {
  const [cfg, setCfg] = useState<any>(null)
  const [perfiles, setPerfiles] = useState<any[]>([])
  const [partidos, setPartidos] = useState<any[]>([])
  const [temporada, setTemporada] = useState<any>(null)
  const [cuentas, setCuentas] = useState(0)
  const [votos, setVotos] = useState<any[]>([])
  const [mvps, setMvps] = useState<any[]>([])
  const [hor, setHor] = useState<Horario>(horarioVacio())
  const [lugar, setLugar] = useState('')
  const [nombre, setNombre] = useState('')
  const [pos, setPos] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const aviso = (t: string) => {
    setMsg(t)
    setTimeout(() => setMsg(''), 3500)
  }

  const cargar = async () => {
    const [cf, pr, pt, tp, cu] = await Promise.all([
      supabase.from('configuracion').select('*').single(),
      supabase.from('perfiles').select('*').eq('activo', true).order('nombre'),
      supabase.from('partidos').select('*').order('fecha', { ascending: false }).limit(6),
      supabase.from('temporadas').select('*').eq('activa', true).maybeSingle(),
      supabase.rpc('cuentas_disponibles'),
    ])
    setCfg(cf.data)
    setPerfiles(pr.data || [])
    setPartidos(pt.data || [])
    setTemporada(tp.data || null)
    setCuentas(cu.error ? 0 : (cu.data || []).length)
    if (cf.data?.admin_ve_votos) {
      const [a, b] = await Promise.all([
        supabase.from('votos').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('votos_mvp').select('*').order('created_at', { ascending: false }).limit(1000),
      ])
      setVotos(a.data || [])
      setMvps(b.data || [])
    } else {
      setVotos([]); setMvps([])
    }
  }
  useEffect(() => { cargar() }, [])

  const ajuste = async (campo: string, v: boolean) => {
    const { error } = await supabase.from('configuracion').update({ [campo]: v }).eq('id', true)
    if (error) alert(error.message)
    else cargar()
  }

  const crearPartido = async (e: any) => {
    e.preventDefault()
    if (!hor.fecha) return aviso('Elige el día del partido')
    const t = aTimestamps(hor)
    const base = { fecha: t.fecha, lugar: lugar || null, creado_por: yo.id }
    let r: any = await supabase.from('partidos').insert({ ...base, fecha_fin: t.fecha_fin })
    let sinFin = false
    if (r.error && /fecha_fin/.test(r.error.message)) {
      sinFin = true // aún no se ha ejecutado 13_horario.sql: se crea solo con la hora de inicio
      r = await supabase.from('partidos').insert(base)
    }
    if (r.error) return alert(r.error.message)
    setHor({ ...horarioVacio() }); setLugar('')
    aviso(sinFin ? '✅ Partido creado (sin hora de fin: falta ejecutar 13_horario.sql)' : '✅ Partido creado y avisado a todos')
    cargar()
  }

  const anadirExterno = async (e: any) => {
    e.preventDefault()
    if (!nombre.trim()) return
    const { error } = await supabase.from('perfiles').insert({ nombre: nombre.trim(), posicion: pos || null, es_externo: true })
    if (error) return alert(error.message)
    setNombre(''); setPos('')
    aviso('✅ Externo añadido')
  }

  const nuevaTemporada = async () => {
    const n = prompt('Nombre de la nueva temporada (por ejemplo, 2026/27):')
    if (!n || !n.trim()) return
    if (!confirm(`Se cerrará${temporada ? ` "${temporada.nombre}"` : ' la temporada actual'} y empezará "${n.trim()}". Los partidos nuevos irán a la nueva. ¿Seguro?`)) return
    const { error } = await supabase.rpc('nueva_temporada', { p_nombre: n.trim() })
    if (error) return alert(error.message)
    aviso('✅ Temporada nueva creada')
    cargar()
  }

  const recalcularLogros = async () => {
    if (!confirm('Se borrarán todos los logros y se volverán a calcular con los partidos actuales. ¿Seguro?')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('reiniciar_logros')
    setBusy(false)
    if (error) return alert(error.message)
    aviso(`✅ Logros recalculados (${data} concedidos)`)
  }

  const mantenimiento = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('mantenimiento', { p_forzar: true })
    setBusy(false)
    if (error) return alert(error.message)
    aviso('✅ Mantenimiento hecho: logros y avisos al día')
  }

  if (!cfg) return <p className="c">Cargando…</p>

  const nom = (jid: string) => {
    const j = perfiles.find((x) => x.id === jid)
    return j ? j.apodo || j.nombre : '?'
  }

  return (
    <>
      {msg && <div className="toast">{msg}</div>}
      <div className="row" style={{ margin: '12px 0' }}>
        <button className="sec mini" onClick={onBack}>← Perfil</button>
      </div>
      <h2 style={{ marginTop: 0 }}>Panel de admin</h2>
      <p className="mut">Todas tus herramientas en un sitio.</p>

      <h2>⚽ Partidos</h2>
      <div className="card">
        <b>Crear convocatoria</b>
        <form onSubmit={crearPartido} style={{ marginTop: 8 }}>
          <HorarioPicker valor={hor} onChange={setHor} />
          <input placeholder="Lugar (opcional)" value={lugar} onChange={(e) => setLugar(e.target.value)} />
          <button type="submit">Crear partido</button>
        </form>
      </div>
      {partidos.length > 0 && (
        <div className="card">
          <b>Últimos partidos</b>
          <div className="mut" style={{ marginBottom: 4 }}>Entra para gestionar convocatoria, equipos, resultado, cierre y fecha o lugar.</div>
          {partidos.map((p) => (
            <div className="fila" key={p.id} style={{ cursor: 'pointer' }} onClick={() => onPartido(p.id)}>
              <span>
                {horario(p)}
                {p.goles_a != null && <b> · {p.goles_a}-{p.goles_b}</b>}
              </span>
              <span className="tag">{ESTADO[p.estado] || p.estado}</span>
            </div>
          ))}
        </div>
      )}

      <h2>🗳️ Votaciones</h2>
      <div className="card">
        <div className="fila">
          <span>Votación inicial</span>
          <button className="sec mini" onClick={() => ajuste('votacion_inicial_abierta', !cfg.votacion_inicial_abierta)}>
            {cfg.votacion_inicial_abierta ? 'Abierta · cerrar' : 'Cerrada · abrir'}
          </button>
        </div>
        <div className="fila">
          <span>Yo veo quién vota a quién</span>
          <button className="sec mini" onClick={() => ajuste('admin_ve_votos', !cfg.admin_ve_votos)}>
            {cfg.admin_ve_votos ? 'Sí · ocultar' : 'No · ver'}
          </button>
        </div>
      </div>
      {cfg.admin_ve_votos && (
        <details className="card">
          <summary>Ver votos de todos (solo tú)</summary>
          {perfiles.filter((j) => votos.some((v) => v.votado_id === j.id)).map((j) => (
            <div key={j.id} style={{ margin: '10px 0' }}>
              <b>{j.apodo || j.nombre}</b>
              <div className="mut">
                {votos
                  .filter((v) => v.votado_id === j.id)
                  .map((v) => {
                    const pt = partidos.find((p) => p.id === v.partido_id)
                    const donde = v.partido_id === null ? 'ini' : pt ? new Date(pt.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'numeric' }) : 'partido'
                    return `${nom(v.votante_id)} ${Number(v.nota)} (${donde})`
                  })
                  .join(' · ')}
              </div>
            </div>
          ))}
          {mvps.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <b>🏆 Votos de MVP</b>
              <div className="mut">{mvps.map((m) => `${nom(m.votante_id)} → ${nom(m.votado_id)}`).join(' · ')}</div>
            </div>
          )}
          {votos.length === 0 && mvps.length === 0 && <p className="mut">Todavía no hay votos.</p>}
        </details>
      )}

      <h2>👥 Jugadores</h2>
      <div className="card">
        <button className="sec" style={{ width: '100%' }} onClick={() => onTab('jugadores')}>
          Plantilla: medias, editar y vincular ›
        </button>
        {cuentas > 0 && (
          <p className="mut" style={{ margin: '8px 0 0' }}>
            Hay {cuentas} {cuentas === 1 ? 'cuenta nueva' : 'cuentas nuevas'} sin partidos ni votos que se podrían vincular con un externo.
          </p>
        )}
      </div>
      <div className="card">
        <b>Añadir externo</b>
        <form onSubmit={anadirExterno} style={{ marginTop: 8 }}>
          <input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <select value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="">Posición (opcional)</option>
            <option value="portero">Portero</option>
            <option value="defensa">Defensa</option>
            <option value="medio">Medio</option>
            <option value="delantero">Delantero</option>
          </select>
          <button type="submit">Añadir</button>
        </form>
      </div>

      <h2>🏆 Temporada y logros</h2>
      <div className="card">
        <div className="mut" style={{ marginBottom: 8 }}>Temporada actual: <b style={{ color: 'var(--txt)' }}>{temporada?.nombre || '—'}</b></div>
        <button className="sec" style={{ width: '100%' }} onClick={nuevaTemporada}>Empezar nueva temporada</button>
        <p className="mut">Cierra la actual y abre otra. Las medias no se reinician; solo cambia el ranking.</p>
        <button className="sec" style={{ width: '100%' }} disabled={busy} onClick={recalcularLogros}>Recalcular todos los logros</button>
        <p className="mut" style={{ marginBottom: 0 }}>Útil si has corregido un resultado antiguo. No avisa a nadie.</p>
      </div>

      <h2>🔧 Sistema</h2>
      <div className="card">
        <button className="sec" style={{ width: '100%' }} disabled={busy} onClick={mantenimiento}>Ejecutar mantenimiento ahora</button>
        <p className="mut" style={{ marginBottom: 0 }}>Concede logros pendientes y lanza los avisos por tiempo. La app ya lo hace sola cada pocos minutos.</p>
      </div>
    </>
  )
}
