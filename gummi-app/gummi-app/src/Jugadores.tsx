import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Ficha from './Ficha'

export default function Jugadores({ yo }: { yo: any }) {
  const admin = yo.rol === 'admin'
  const [lista, setLista] = useState<any[]>([])
  const [notas, setNotas] = useState<Record<string, any>>({})
  const [manuales, setManuales] = useState<Record<string, any>>({})
  const [nombre, setNombre] = useState('')
  const [pos, setPos] = useState('')
  const [ficha, setFicha] = useState<string | null>(null)

  const cargar = async () => {
    const { data } = await supabase.from('perfiles').select('*').order('nombre')
    setLista(data || [])
    if (admin) {
      const n = await supabase.rpc('notas_jugadores')
      if (!n.error) {
        const m: Record<string, any> = {}
        for (const r of n.data || []) m[r.jugador_id] = r
        setNotas(m)
      }
      const mm = await supabase.from('notas_manuales').select('*')
      const o: Record<string, any> = {}
      for (const r of mm.data || []) o[r.jugador_id] = r
      setManuales(o)
    }
  }
  useEffect(() => { cargar() }, [])

  const anadir = async (e: any) => {
    e.preventDefault()
    if (!nombre.trim()) return
    const { error } = await supabase.from('perfiles')
      .insert({ nombre: nombre.trim(), posicion: pos || null, es_externo: true })
    if (error) alert(error.message)
    else { setNombre(''); setPos(''); cargar() }
  }

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
    if (!(n >= 1 && n <= 10)) return alert('La nota debe estar entre 1 y 10')
    if (manuales[jid] && Number(manuales[jid].nota) === n) return
    const { error } = await supabase.from('notas_manuales').upsert(
      { jugador_id: jid, nota: n, updated_at: new Date().toISOString() },
      { onConflict: 'jugador_id' }
    )
    if (error) alert(error.message)
    else cargar()
  }

  if (ficha) return <Ficha id={ficha} yo={yo} onBack={() => setFicha(null)} />

  return (
    <>
      <h2>Jugadores ({lista.length})</h2>
      {admin && <p className="mut">Las notas solo las ves tú. A los externos y a quien aún no tenga votos les pones la nota a mano.</p>}
      {lista.map((j) => {
        const n = notas[j.id]
        const manual = manuales[j.id]
        return (
          <div className="card" key={j.id}>
            <div className="row">
              <b style={{ flex: 1, cursor: 'pointer' }} onClick={() => setFicha(j.id)}>{j.apodo || j.nombre} ›</b>
              {j.posicion && <span className="tag">{j.posicion}</span>}
              {j.es_externo && <span className="tag">externo</span>}
              {j.rol === 'admin' && <span className="tag">admin</span>}
            </div>
            {admin && (
              <div className="row" style={{ marginTop: 6 }}>
                <span className="mut" style={{ flex: 1 }}>
                  Nota: {n?.nota != null ? Number(n.nota).toFixed(1) : '–'}
                  {n?.fuente === 'votos' && ` (${n.num_votos} votos)`}
                  {n?.fuente === 'manual' && ' (manual)'}
                </span>
                {(j.es_externo || n?.fuente !== 'votos') && (
                  <input
                    key={j.id + ':' + (manual?.nota ?? '')}
                    style={{ width: 90 }}
                    inputMode="decimal"
                    placeholder="Manual"
                    defaultValue={manual ? String(Number(manual.nota)) : ''}
                    onBlur={(e) => guardarManual(j.id, e.target.value)}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}
      {admin && (
        <>
          <h2>Añadir externo</h2>
          <form onSubmit={anadir}>
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
        </>
      )}
    </>
  )
}
