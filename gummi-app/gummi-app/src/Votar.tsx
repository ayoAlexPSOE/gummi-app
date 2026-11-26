import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Avatar from './Avatar'
import { Cargando, vibra } from './movil'

const NOTAS = Array.from({ length: 11 }, (_, i) => i)

// Fila de casillas 0-10: toca una nota para ponerla y vuelve a tocarla para quitarla.
function Selector({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  return (
    <div className="nota-chips">
      {NOTAS.map((n) => (
        <button
          type="button"
          key={n}
          className={'nc' + (valor === String(n) ? ' on' : '')}
          style={{ ['--c' as any]: `hsl(${n * 12}, 80%, 52%)` }}
          onClick={() => { vibra(6); onChange(valor === String(n) ? '' : String(n)) }}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Votar({ yo }: { yo: any }) {
  const [cfg, setCfg] = useState<any>(null)
  const [perfiles, setPerfiles] = useState<any[]>([])
  const [mios, setMios] = useState<any[]>([]) // mis votos
  const [misMvp, setMisMvp] = useState<any[]>([]) // mis votos de MVP
  const [partidos, setPartidos] = useState<any[]>([])
  const [part, setPart] = useState<any[]>([])
  const [ed, setEd] = useState<Record<string, string>>({})
  const [mvpEd, setMvpEd] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [editando, setEditando] = useState<Record<string, boolean>>({})
  const [aviso, setAviso] = useState('')

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
    setCfg(cf.data)
    setPerfiles(pr.data || [])
    setMios(vo.data || [])
    setMisMvp(mv.data || [])
    setPartidos(pt.data || [])
    setPart(pa.data || [])
    setEd({})
    setMvpEd({})
  }
  useEffect(() => { cargar() }, [])

  if (!cfg) return <Cargando />

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
    if (!fallo) {
      vibra(25)
      setEditando((x) => ({ ...x, [pid === null ? 'ini' : String(pid)]: false }))
      setAviso('✅ Voto guardado')
      setTimeout(() => setAviso(''), 3000)
    }
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
        <div className="vacio"><span>🗳️</span><b>Nada que votar ahora</b><div className="mut">Después de cada partido tendrás 48 h para puntuar a tus compañeros y elegir al MVP.</div></div>
      )}

      {aviso && <div className="toast">{aviso}</div>}

      {abiertos.map((p) => {
        const cands = candidatosPartido(p.id)
        const nVotados = mios.filter((v) => v.partido_id === p.id).length
        const tiene = nVotados > 0 || misMvp.some((m) => m.partido_id === p.id)
        if (tiene && !editando[String(p.id)]) {
          return (
            <div className="card hecho" key={p.id}>
              <div className="row">
                <span style={{ fontSize: 26 }}>✅</span>
                <span style={{ flex: 1 }}>
                  <b>Voto guardado</b>
                  <div className="mut">
                    Partido del {fmt(p.fecha)} · has puntuado a {nVotados}. Puedes cambiarlo hasta el {fmt(p.votacion_hasta)}.
                  </div>
                </span>
                <button className="sec mini" onClick={() => setEditando({ ...editando, [String(p.id)]: true })}>Editar</button>
              </div>
            </div>
          )
        }
        return (
          <div className="card" key={p.id}>
            <b>Partido del {fmt(p.fecha)}</b>
            <div className="mut">Puedes votar hasta el {fmt(p.votacion_hasta)}. Toca solo a quien quieras puntuar.</div>
            {cands.map((j: any) => (
              <div className="fila voto" key={j.id}>
                <span className="voto-nombre"><Avatar p={j} size={24} />{j.apodo || j.nombre}{valor(p.id, j.id) !== '' && <b className="voto-val">{valor(p.id, j.id)}</b>}</span>
                <Selector valor={valor(p.id, j.id)} onChange={(v) => setEd({ ...ed, [clave(p.id, j.id)]: v })} />
              </div>
            ))}
            <div className="mvp-elige">
              <b>👑 Tu MVP</b>
              <div className="mvp-opciones">
                {cands.map((j: any) => {
                  const sel = valorMvp(p.id) === j.id
                  return (
                    <button type="button" key={j.id} className={'sec' + (sel ? ' on2' : '')} onClick={() => { vibra(); setMvpEd({ ...mvpEd, [p.id]: sel ? '' : j.id }) }}>
                      <Avatar p={j} size={30} /><span>{j.apodo || j.nombre}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <button className="guardar-fijo" disabled={busy} onClick={() => guardar(p.id, cands)}>{busy ? 'Guardando…' : 'Guardar votos del partido'}</button>
          </div>
        )
      })}

      {cfg.votacion_inicial_abierta && votadosIni > 0 && !editando['ini'] && (
        <div className="card hecho">
          <div className="row">
            <span style={{ fontSize: 26 }}>{votadosIni >= candidatosIni.length ? '✅' : '📝'}</span>
            <span style={{ flex: 1 }}>
              <b>{votadosIni >= candidatosIni.length ? 'Votación inicial guardada' : 'Votación inicial a medias'}</b>
              <div className="mut">Has puntuado a {votadosIni} de {candidatosIni.length}.</div>
            </span>
            <button className="sec mini" onClick={() => setEditando({ ...editando, ini: true })}>
              {votadosIni >= candidatosIni.length ? 'Editar' : 'Seguir'}
            </button>
          </div>
        </div>
      )}
      {cfg.votacion_inicial_abierta && (votadosIni === 0 || editando['ini']) && (
        <div className="card">
          <b>Votación inicial</b>
          <div className="mut">
            Puntúa a todos del 0 al 10 (a ti no). Es la base de la media de cada jugador, que solo ve el admin. Has votado a {votadosIni} de {candidatosIni.length}.
          </div>
          {candidatosIni.map((j) => (
            <div className="fila voto" key={j.id}>
              <span className="voto-nombre"><Avatar p={j} size={24} />{j.apodo || j.nombre}{valor(null, j.id) !== '' && <b className="voto-val">{valor(null, j.id)}</b>}</span>
              <Selector valor={valor(null, j.id)} onChange={(v) => setEd({ ...ed, [clave(null, j.id)]: v })} />
            </div>
          ))}
          <button className="guardar-fijo" disabled={busy} onClick={() => guardar(null, candidatosIni)}>{busy ? 'Guardando…' : 'Guardar votación inicial'}</button>
        </div>
      )}

    </>
  )
}
