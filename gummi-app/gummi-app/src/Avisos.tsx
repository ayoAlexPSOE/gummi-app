import { useEffect, useState } from 'react'
import { supabase } from './supabase'

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
      await supabase.from('notificaciones').update({ leida: true }).eq('id', n.id)
      onCambio()
    }
    onIr(n.destino, n.ref)
  }
  const todasLeidas = async () => {
    await supabase.from('notificaciones').update({ leida: true }).eq('leida', false)
    await cargar()
    onCambio()
  }
  const borrarTodas = async () => {
    if (!confirm('¿Borrar todos los avisos?')) return
    await supabase.from('notificaciones').delete().gte('id', 0)
    await cargar()
    onCambio()
  }

  if (fallo) return <p className="mut">No se pudieron cargar los avisos. Comprueba que se ha ejecutado en Supabase el script 08_avisos.sql.</p>
  if (!lista) return <p className="c">Cargando…</p>

  return (
    <>
      <h2>Avisos</h2>
      {lista.length === 0 && <p className="mut">No tienes avisos.</p>}
      {lista.map((n) => (
        <div key={n.id} className={'card' + (n.leida ? '' : ' unread')} style={{ cursor: 'pointer' }} onClick={() => abrir(n)}>
          <div className="row">
            <b style={{ flex: 1 }}>{n.titulo}</b>
            <span className="mut">{hace(n.created_at)}</span>
          </div>
          {n.cuerpo && <div className="mut">{n.cuerpo}</div>}
        </div>
      ))}
      {lista.length > 0 && (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="sec" onClick={todasLeidas}>Marcar todas como leídas</button>
          <button className="sec" onClick={borrarTodas}>Borrar todas</button>
        </div>
      )}
    </>
  )
}
