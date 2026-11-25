import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import PartidoDetalle from './PartidoDetalle'

const OPCIONES: [string, string][] = [['voy', 'Voy'], ['duda', 'Duda'], ['no_voy', 'No voy']]

export default function Partidos({ yo }: { yo: any }) {
  const admin = yo.rol === 'admin'
  const [partidos, setPartidos] = useState<any[]>([])
  const [conv, setConv] = useState<any[]>([])
  const [fecha, setFecha] = useState('')
  const [lugar, setLugar] = useState('')
  const [abierto, setAbierto] = useState<number | null>(null)

  const cargar = async () => {
    const p = await supabase.from('partidos').select('*').order('fecha', { ascending: false })
    const c = await supabase.from('convocatorias').select('*')
    setPartidos(p.data || [])
    setConv(c.data || [])
  }
  useEffect(() => { if (abierto === null) cargar() }, [abierto])

  const crear = async (e: any) => {
    e.preventDefault()
    if (!fecha) return
    const { error } = await supabase.from('partidos')
      .insert({ fecha: new Date(fecha).toISOString(), lugar: lugar || null, creado_por: yo.id })
    if (error) alert(error.message)
    else { setFecha(''); setLugar(''); cargar() }
  }

  const responder = async (partido_id: number, respuesta: string) => {
    const { error } = await supabase.from('convocatorias').upsert(
      { partido_id, jugador_id: yo.id, respuesta, updated_at: new Date().toISOString() },
      { onConflict: 'partido_id,jugador_id' }
    )
    if (error) alert(error.message)
    else cargar()
  }

  if (abierto !== null) {
    return <PartidoDetalle id={abierto} yo={yo} onBack={() => setAbierto(null)} />
  }

  return (
    <>
      <h2>Partidos</h2>
      {partidos.length === 0 && <p className="mut">Todavía no hay partidos.</p>}
      {partidos.map((p) => {
        const mias = conv.find((c) => c.partido_id === p.id && c.jugador_id === yo.id)
        const voy = conv.filter((c) => c.partido_id === p.id && c.respuesta === 'voy').length
        return (
          <div className="card" key={p.id}>
            <div className="row" style={{ cursor: 'pointer' }} onClick={() => setAbierto(p.id)}>
              <b style={{ flex: 1 }}>
                {new Date(p.fecha).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </b>
              {p.goles_a != null && <b>{p.goles_a} - {p.goles_b}</b>}
              <span className="tag">{p.estado}</span>
            </div>
            <div className="mut" style={{ cursor: 'pointer' }} onClick={() => setAbierto(p.id)}>
              {p.lugar || 'Sin lugar'} · {voy} confirmados · Ver detalle ›
            </div>
            {p.estado === 'convocatoria' && (
              <div className="row" style={{ marginTop: 8 }}>
                {OPCIONES.map(([v, t]) => (
                  <button key={v} className={'sec' + (mias?.respuesta === v ? ' on2' : '')} onClick={() => responder(p.id, v)}>{t}</button>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {admin && (
        <>
          <h2>Nuevo partido</h2>
          <form onSubmit={crear}>
            <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            <input placeholder="Lugar (opcional)" value={lugar} onChange={(e) => setLugar(e.target.value)} />
            <button type="submit">Crear partido</button>
          </form>
        </>
      )}
    </>
  )
}
