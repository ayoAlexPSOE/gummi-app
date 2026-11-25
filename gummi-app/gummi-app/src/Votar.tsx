import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const NOTAS = Array.from({ length: 19 }, (_, i) => 1 + i * 0.5)

function Selector({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <select value={valor} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {NOTAS.map((n) => (
        <option key={n} value={String(n)}>{n}</option>
      ))}
    </select>
  )
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Votar({ yo }: { yo: any }) {
  const admin = yo.rol === 'admin'
  const [cfg, setCfg] = useState<any>(null)
  const [perfiles, setPerfiles] = useState<any[]>([])
  const [mios, setMios] = useState<any[]>([]) // mis votos
  const [misMvp, setMisMvp] = useState<any[]>([]) // mis votos de MVP
  const [votos, setVotos] = useState<any[]>([]) // votos de todos (solo admin, si lo tiene activado)
  const [mvps, setMvps] = useState<any[]>([])
  const [partidos, setPartidos] = useState<any[]>([])
  const [part, setPart] = useState<any[]>([])
  const [ed, setEd] = useState<Record<string, string>>({})
  const [mvpEd, setMvpEd] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const cargar = async () => {
    const [cf, pr, vo, mv, pt] = await Promise.all([
      supabase.from('configuracion').select('*').single(),
      supabase.from('perfiles').select('*').eq('activo', true).order('nombre'),
      supabase.from('votos').select('*').eq('votante_id', yo.id),
      supabase.from('votos_mvp').select('*').eq('votante_id', yo.id),
      supabase.from('partidos').select('*').eq('estado', 'jugado').order('fecha', { ascending: false }).limit(10),
    ])
    const ids = (pt.data || []).map((p: any) => p.id)
    const pa: any = ids.length
      ? await supabase.from('participaciones').select('*').in('partido_id', ids)
      : { data: [] }
    let todosV: any[] = []
    let todosM: any[] = []
    if (admin && cf.data?.admin_ve_votos) {
      const a = await supabase.from('votos').select('*').order('created_at', { ascending: false }).limit(1000)
      const b = await supabase.from('votos_mvp').select('*').order('created_at', { ascending: false }).limit(1000)
      todosV = a.data || []
      todosM = b.data || []
    }
    setCfg(cf.data)
    setPerfiles(pr.data || [])
    setMios(vo.data || [])
    setMisMvp(mv.data || [])
    setVotos(todosV)
    setMvps(todosM)
    setPartidos(pt.data || [])
    setPart(pa.data || [])
    setEd({})
    setMvpEd({})
  }
  useEffect(() => { cargar() }, [])

  if (!cfg) return <p className="c">Cargando…</p>

  const nombre = (jid: string) => {
    const j = perfiles.find((x) => x.id === jid)
    return j ? j.apodo || j.nombre : '?'
  }

  const clave = (pid: number | null, jid: string) => `${pid ?? 'ini'}:${jid}`
  const buscar = (pid: number | null, jid: string) =>
    mios.find((v) => v.votado_id === jid && (pid === null ? v.partido_id === null : v.partido_id === pid))
  const valor = (pid: number | null, jid: string) => {
    const k = clave(pid, jid)
    if (ed[k] !== undefined) return ed[k]
    const ex = buscar(pid, jid)
    return ex ? String(Number(ex.nota)) : ''
  }
  const valorMvp = (pid: number) => {
    if (mvpEd[pid] !== undefined) return mvpEd[pid]
    return misMvp.find((m) => m.partido_id === pid)?.votado_id || ''
  }

  const guardar = async (pid: number | null, candidatos: any[]) => {
    setBusy(true)
    let fallo = ''
    for (const j of candidatos) {
      const val = ed[clave(pid, j.id)]
      if (val === undefined) continue
      const ex = buscar(pid, j.id)
      let r: any = null
      if (val === '') {
        if (ex) r = await supabase.from('votos').delete().eq('id', ex.id)
      } else {
        const nota = Number(val)
        if (ex) {
          if (Number(ex.nota) !== nota) r = await supabase.from('votos').update({ nota }).eq('id', ex.id)
        } else {
          r = await supabase.from('votos').insert({ partido_id: pid, votante_id: yo.id, votado_id: j.id, nota })
        }
      }
      if (r?.error) fallo = r.error.message
    }
    if (pid !== null && mvpEd[pid] !== undefined) {
      const sel = mvpEd[pid]
      const ex = misMvp.find((m) => m.partido_id === pid)
      let r: any = null
      if (!sel) {
        if (ex) r = await supabase.from('votos_mvp').delete().eq('partido_id', pid).eq('votante_id', yo.id)
      } else if (ex) {
        r = await supabase.from('votos_mvp').update({ votado_id: sel }).eq('partido_id', pid).eq('votante_id', yo.id)
      } else {
        r = await supabase.from('votos_mvp').insert({ partido_id: pid, votante_id: yo.id, votado_id: sel })
      }
      if (r?.error) fallo = r.error.message
    }
    setBusy(false)
    if (fallo) alert('No se pudo guardar todo. Puede que la votación haya terminado.\n\n' + fallo)
    await cargar()
  }

  const ajuste = async (campo: string, v: boolean) => {
    const { error } = await supabase.from('configuracion').update({ [campo]: v }).eq('id', true)
    if (error) alert(error.message)
    else cargar()
  }

  // ---------- votación inicial ----------
  const candidatosIni = perfiles.filter((j) => !j.es_externo && j.id !== yo.id)
  const votadosIni = candidatosIni.filter((j) => buscar(null, j.id)).length

  // ---------- votaciones de partidos abiertos en los que he jugado ----------
  const ahora = Date.now()
  const abiertos = partidos.filter(
    (p) =>
      p.votacion_hasta &&
      new Date(p.votacion_hasta).getTime() > ahora &&
      part.some((x) => x.partido_id === p.id && x.jugador_id === yo.id)
  )

  const candidatosPartido = (pid: number) =>
    part
      .filter((x) => x.partido_id === pid && x.jugador_id !== yo.id)
      .map((x) => perfiles.find((j) => j.id === x.jugador_id))
      .filter((j) => j && !j.es_externo)

  return (
    <>
      <h2>Votar</h2>

      {abiertos.length === 0 && !cfg.votacion_inicial_abierta && (
        <p className="mut">Ahora mismo no hay nada que votar.</p>
      )}

      {abiertos.map((p) => {
        const cands = candidatosPartido(p.id)
        return (
          <div className="card" key={p.id}>
            <b>Partido del {fmt(p.fecha)}</b>
            <div className="mut">Puedes votar hasta el {fmt(p.votacion_hasta)}. Toca solo a quien quieras puntuar.</div>
            {cands.map((j: any) => (
              <div className="fila" key={j.id}>
                <span>{j.apodo || j.nombre}</span>
                <Selector valor={valor(p.id, j.id)} onChange={(v) => setEd({ ...ed, [clave(p.id, j.id)]: v })} />
              </div>
            ))}
            <div className="fila">
              <b>🏆 MVP</b>
              <select value={valorMvp(p.id)} onChange={(e) => setMvpEd({ ...mvpEd, [p.id]: e.target.value })}>
                <option value="">—</option>
                {cands.map((j: any) => (
                  <option key={j.id} value={j.id}>{j.apodo || j.nombre}</option>
                ))}
              </select>
            </div>
            <button style={{ marginTop: 10 }} disabled={busy} onClick={() => guardar(p.id, cands)}>Guardar votos del partido</button>
          </div>
        )
      })}

      {cfg.votacion_inicial_abierta && (
        <div className="card">
          <b>Votación inicial</b>
          <div className="mut">
            Puntúa a todos del 1 al 10 (a ti no). Es la base de la nota de cada jugador. Has votado a {votadosIni} de {candidatosIni.length}.
          </div>
          {candidatosIni.map((j) => (
            <div className="fila" key={j.id}>
              <span>{j.apodo || j.nombre}</span>
              <Selector valor={valor(null, j.id)} onChange={(v) => setEd({ ...ed, [clave(null, j.id)]: v })} />
            </div>
          ))}
          <button style={{ marginTop: 10 }} disabled={busy} onClick={() => guardar(null, candidatosIni)}>Guardar votación inicial</button>
        </div>
      )}

      {admin && (
        <>
          <h2>Ajustes (admin)</h2>
          <div className="card">
            <div className="fila">
              <span>Votación inicial</span>
              <button className="sec mini" onClick={() => ajuste('votacion_inicial_abierta', !cfg.votacion_inicial_abierta)}>
                {cfg.votacion_inicial_abierta ? 'Abierta · cerrar' : 'Cerrada · abrir'}
              </button>
            </div>
            <div className="fila">
              <span>Notas visibles para todos</span>
              <button className="sec mini" onClick={() => ajuste('notas_visibles', !cfg.notas_visibles)}>
                {cfg.notas_visibles ? 'Sí · ocultar' : 'No · mostrar'}
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
                        return `${nombre(v.votante_id)} ${Number(v.nota)} (${donde})`
                      })
                      .join(' · ')}
                  </div>
                </div>
              ))}
              {mvps.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <b>🏆 Votos de MVP</b>
                  <div className="mut">
                    {mvps.map((m) => `${nombre(m.votante_id)} → ${nombre(m.votado_id)}`).join(' · ')}
                  </div>
                </div>
              )}
              {votos.length === 0 && mvps.length === 0 && <p className="mut">Todavía no hay votos.</p>}
            </details>
          )}
        </>
      )}
    </>
  )
}
