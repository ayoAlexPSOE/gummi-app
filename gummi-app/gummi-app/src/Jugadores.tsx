import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Media from './Media'
import { aviso, confirmar } from './dialogos'
import { invalidar, perfilesActivos } from './datos'
import Ficha from './Ficha'
import Avatar from './Avatar'
import OnceIdeal from './OnceIdeal'
import { useAtras } from './movil'
import { POSICIONES, abrevPos } from './equipos'

export default function Jugadores({ yo }: { yo: any }) {
  const admin = yo.rol === 'admin'
  const [lista, setLista] = useState<any[]>([])
  const [notas, setNotas] = useState<Record<string, any>>({})
  const [manuales, setManuales] = useState<Record<string, any>>({})
  const [ficha, setFicha] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [eNombre, setENombre] = useState('')
  const [eApodo, setEApodo] = useState('')
  const [ePos, setEPos] = useState('')
  const [cuentas, setCuentas] = useState<any[]>([])
  const [vincId, setVincId] = useState<string | null>(null)
  const [vincCuenta, setVincCuenta] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  useAtras(ficha !== null, () => setFicha(null))

  const cargar = async () => {
    const { data } = await perfilesActivos()
    setLista(data || [])
    if (admin) {
      const n = await supabase.rpc('notas_jugadores')
      if (!n.error) {
        const m: Record<string, any> = {}
        for (const r of n.data || []) m[r.jugador_id] = r
        setNotas(m)
      }
      const cu = await supabase.rpc('cuentas_disponibles')
      setCuentas(cu.error ? [] : cu.data || [])
      const mm = await supabase.from('notas_manuales').select('*')
      const o: Record<string, any> = {}
      for (const r of mm.data || []) o[r.jugador_id] = r
      setManuales(o)
    }
  }
  useEffect(() => { cargar() }, [])

  const guardarManual = async (jid: string, texto: string) => {
    const t = texto.trim().replace(',', '.')
    if (!t) {
      if (manuales[jid]) {
        await supabase.from('notas_manuales').delete().eq('jugador_id', jid)
        cargar()
      }
      return
    }
    const n = Number(t)
    if (!(n >= 0 && n <= 99)) return aviso('La media debe estar entre 0 y 99')
    if (manuales[jid] && Number(manuales[jid].nota) === n) return
    const { error } = await supabase.from('notas_manuales').upsert(
      { jugador_id: jid, nota: n, updated_at: new Date().toISOString() },
      { onConflict: 'jugador_id' }
    )
    if (error) aviso(error.message, 'error')
    else cargar()
  }

  const empezarEdicion = (j: any) => {
    setEditId(j.id); setENombre(j.nombre); setEApodo(j.apodo || ''); setEPos(j.posicion || '')
  }
  const guardarEdicion = async () => {
    if (!eNombre.trim()) return aviso('El nombre no puede estar vacío')
    const { error } = await supabase.from('perfiles')
      .update({ nombre: eNombre.trim(), apodo: eApodo.trim() || null, posicion: ePos || null })
      .eq('id', editId)
    if (error) return aviso(error.message, 'error')
    setEditId(null)
    invalidar('perfiles')
    cargar()
  }
  const vincular = async (externo: string) => {
    const c = cuentas.find((x) => x.user_id === vincCuenta)
    if (!c) return
    if (!(await confirmar(`Vincular este externo con la cuenta "${c.nombre}"? Conservará todo su histórico.`))) return
    const { error } = await supabase.rpc('vincular_externo', { p_externo: externo, p_user_id: c.user_id })
    if (error) return aviso(error.message, 'error')
    setVincId(null); setVincCuenta('')
    invalidar('perfiles')
    cargar()
  }

  if (ficha) return <Ficha id={ficha} yo={yo} onBack={() => setFicha(null)} />

  return (
    <>
      <OnceIdeal perfiles={lista} onFicha={(id) => setFicha(id)} />
      <h2>Plantilla ({lista.length})</h2>
      {admin && <p className="mut">Las medias (0-99) solo las ves tú y el generador de equipos. A los externos y a quien aún no tenga votos les pones la media a mano.</p>}
      {lista.map((j) => {
        const n = notas[j.id]
        const manual = manuales[j.id]
        const desplegado = abierto === j.id
        return (
          <div className="jug" key={j.id}>
            <div className="jug-fila">
              <Avatar p={j} size={32} />
              <span className="jug-nombre" onClick={() => setFicha(j.id)}>{j.apodo || j.nombre}{j.id === yo.id && <span className="mut"> (tú)</span>}</span>
              {j.dorsal != null && <span className="dorsal-mini" title="Dorsal">#{j.dorsal}</span>}
              {j.posicion && <span className={'tag pos-' + j.posicion}>{abrevPos(j.posicion)}</span>}
              {j.es_externo && <span className="tag">externo</span>}
              {j.rol === 'admin' && <span className="tag">adm</span>}
              {admin && <Media nota={n?.nota} />}
              {admin && (
                <button className="sec mini ico" onClick={() => setAbierto(desplegado ? null : j.id)} aria-label="Opciones">⋯</button>
              )}
            </div>
            {admin && desplegado && (
              <div className="jug-extra">
                <div className="mut">
                  {n?.fuente === 'votos' && `${n.num_votos} votos recibidos`}
                  {n?.fuente === 'mixta' && `${n.num_votos} votos recibidos + tu nota`}
                  {n?.fuente === 'manual' && 'Solo tu nota (aún sin votos)'}
                  {n?.ajuste != null && Number(n.ajuste) !== 0 &&
                    ` · salió de ${Math.round(Number(n.nota_votos))} ${Number(n.ajuste) > 0 ? '+' : ''}${Number(n.ajuste).toFixed(1)}`}
                </div>
                <div className="mut fs12 mt6">Tu nota (0-99) pesa la mitad de su media de partida; la otra mitad, la votación inicial.</div>
                <div className="row mt6">
                  {(
                    <input
                      key={j.id + ':' + (manual?.nota ?? '')}
                      style={{ width: 110 }}
                      inputMode="decimal"
                      placeholder="Tu nota 0-99"
                      defaultValue={manual ? String(Number(manual.nota)) : ''}
                      onBlur={(e) => guardarManual(j.id, e.target.value)}
                    />
                  )}
                  {editId !== j.id && <button className="sec mini" onClick={() => empezarEdicion(j)}>Editar perfil</button>}
                  {j.es_externo && cuentas.length > 0 && (
                    <button className="sec mini" onClick={() => { setVincId(vincId === j.id ? null : j.id); setVincCuenta('') }}>
                      Vincular con cuenta
                    </button>
                  )}
                </div>
                {editId === j.id && (
                  <form className="mt8" onSubmit={(e) => { e.preventDefault(); guardarEdicion() }}>
                    <input placeholder="Nombre" value={eNombre} onChange={(e) => setENombre(e.target.value)} />
                    <input placeholder="Apodo (opcional)" value={eApodo} onChange={(e) => setEApodo(e.target.value)} />
                    <select value={ePos} onChange={(e) => setEPos(e.target.value)}>
                      <option value="">Posición</option>
                      {POSICIONES.map(([id, t]) => <option key={id} value={id}>{t}</option>)}
                    </select>
                    <div className="row">
                      <button type="submit">Guardar</button>
                      <button type="button" className="sec" onClick={() => setEditId(null)}>Cancelar</button>
                    </div>
                  </form>
                )}
                {vincId === j.id && (
                  <div className="mt8">
                    <p className="mut">Elige la cuenta recién creada de este jugador (debe estar sin partidos ni votos).</p>
                    <select value={vincCuenta} onChange={(e) => setVincCuenta(e.target.value)}>
                      <option value="">Cuenta…</option>
                      {cuentas.map((c) => <option key={c.user_id} value={c.user_id}>{c.nombre}</option>)}
                    </select>
                    <button style={{ marginLeft: 8 }} disabled={!vincCuenta} onClick={() => vincular(j.id)}>Vincular</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
