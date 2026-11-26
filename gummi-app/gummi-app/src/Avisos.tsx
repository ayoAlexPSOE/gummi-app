import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { confirmar } from './dialogos'
import { Cargando } from './movil'

const hace = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'ahora'
  if (m < 60) return `hace ${m} min`
  if (m < 1440) return `hace ${Math.floor(m / 60)} h`
  return `hace ${Math.floor(m / 1440)} d`
}

export default function Avisos({ onIr, onCambio }: { onIr: (destino: string | null, ref: number | null) => void; onCambio: () => void }) {
  const [lista, setLista] = useState<any[] | null>(null)
  const [fallo, setFallo] = useState(false)

  const cargar = async () => {
    const { data, error } = await supabase
      .from('notificaciones').select('*').order('created_at', { ascending: false }).limit(50)
    if (error) { setFallo(true); return }
    setLista(data || [])
  }
  useEffect(() => { cargar() }, [])

  const abrir = async (n: any) => {
    if (!n.leida) {
      // Se marca como leída por detrás para que el salto sea inmediato
      supabase.from('notificaciones').update({ leida: true }).eq('id', n.id).then(() => onCambio())
    }
    onIr(n.destino, n.ref)
  }
  const todasLeidas = async () => {
    await supabase.from('notificaciones').update({ leida: true }).eq('leida', false)
    await cargar()
    onCambio()
  }
  const borrarTodas = async () => {
    if (!(await confirmar('¿Borrar todos los avisos?', { si: 'Borrar', peligro: true }))) return
    await supabase.from('notificaciones').delete().gte('id', 0)
    await cargar()
    onCambio()
  }

  if (fallo) return <p className="mut">No se pudieron cargar los avisos. Comprueba que se ha ejecutado en Supabase el script 08_avisos.sql.</p>
  if (!lista) return <Cargando />

  return (
    <>
      <h2>Avisos</h2>
      {lista.length === 0 && <div className="vacio"><span>🔔</span><b>Sin avisos</b><div className="mut">Aquí te llegarán las convocatorias, los equipos, las votaciones y tus logros.</div></div>}
      {lista.map((n) => (
        <div key={n.id} className={'card' + (n.leida ? '' : ' unread')} style={{ cursor: 'pointer' }} onClick={() => abrir(n)}>
          <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <span className="aviso-ic">{n.destino === 'votar' ? '🗳️' : n.destino === 'logros' ? '🏅' : '⚽'}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{n.titulo}</b>
              {n.cuerpo && <div className="mut">{n.cuerpo}</div>}
            </span>
            <span className="mut" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{hace(n.created_at)}</span>
          </div>
        </div>
      ))}
      {lista.length > 0 && (
        <div className="row" style={{ marginTop: 14 }}>
          {lista.some((n) => !n.leida) && <button className="sec" style={{ flex: 1 }} onClick={todasLeidas}>✓ Marcar leídas</button>}
          <button className="sec" style={{ flex: 1 }} onClick={borrarTodas}>🗑️ Borrar todas</button>
        </div>
      )}
    </>
  )
}
