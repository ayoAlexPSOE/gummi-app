import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { perfilesActivos } from './datos'
import { Cargando } from './movil'
import { traerTodo } from './util'

export default function Logros({ yo, onFicha }: { yo: any; onFicha: (id: string) => void }) {
  const [cat, setCat] = useState<any[] | null>(null)
  const [tienen, setTienen] = useState<any[]>([])
  const [perfiles, setPerfiles] = useState<any[]>([])
  const [fallo, setFallo] = useState(false)

  const cargar = async () => {
    const c = await supabase.from('logros').select('*').order('orden')
    if (c.error) {
      setFallo(true)
      return
    }
    const [lj, pr] = await Promise.all([
      traerTodo('logros_jugador', ['id']),
      perfilesActivos(),
    ])
    setCat(c.data || [])
    setTienen(lj || [])
    setPerfiles(pr.data || [])
  }
  useEffect(() => { cargar() }, [])

  if (fallo) {
    return <p className="mut">No se pudieron cargar los logros. Comprueba que se ha ejecutado en Supabase el script 06_logros.sql.</p>
  }
  if (!cat) return <Cargando />

  const nombre = (jid: string) => {
    const j = perfiles.find((x) => x.id === jid)
    return j ? j.apodo || j.nombre : null
  }

  return (
    <>
      <p className="mut">Se consiguen solos al jugar. Toca un nombre para ver su ficha.</p>
      {cat.map((l) => {
        const porJugador = new Map<string, number>()
        for (const t of tienen) {
          if (t.logro_id === l.id) porJugador.set(t.jugador_id, (porJugador.get(t.jugador_id) || 0) + 1)
        }
        const lista = [...porJugador.entries()]
          .filter(([jid]) => nombre(jid))
          .sort((a, b) => b[1] - a[1] || (nombre(a[0]) as string).localeCompare(nombre(b[0]) as string))
        const mio = porJugador.has(yo.id)
        return (
          <div className="card" key={l.id} style={mio ? { outline: '2px solid var(--acc)' } : undefined}>
            <div className="row">
              <span style={{ fontSize: 28 }}>{l.icono}</span>
              <span style={{ flex: 1 }}>
                <b>{l.nombre}</b>
                <div className="mut">{l.descripcion}</div>
              </span>
              <span className="mut">{lista.length}</span>
            </div>
            {lista.length > 0 ? (
              <div className="row" style={{ marginTop: 8 }}>
                {lista.map(([jid, n]) => (
                  <span key={jid} className="tag" style={{ cursor: 'pointer' }} onClick={() => onFicha(jid)}>
                    {nombre(jid)}{n > 1 ? ` ×${n}` : ''}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mut" style={{ marginTop: 6 }}>Nadie todavía</div>
            )}
          </div>
        )
      })}
    </>
  )
}
