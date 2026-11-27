import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { perfilesActivos } from './datos'
import { Cargando } from './movil'
import { traerTodo } from './util'
import Avatar from './Avatar'

// Lista compacta de logros: una fila por logro; al tocarla se despliega quién lo tiene.
export default function Logros({ yo, onFicha }: { yo: any; onFicha: (id: string) => void }) {
  const [cat, setCat] = useState<any[] | null>(null)
  const [tienen, setTienen] = useState<any[]>([])
  const [perfiles, setPerfiles] = useState<any[]>([])
  const [fallo, setFallo] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [soloMios, setSoloMios] = useState(false)

  const cargar = async () => {
    const c = await supabase.from('logros').select('*').order('orden')
    if (c.error) {
      setFallo(true)
      return
    }
    const [lj, pr] = await Promise.all([traerTodo('logros_jugador', ['id']), perfilesActivos()])
    setCat((c.data || []).filter((l: any) => l.activo !== false)) // los retirados no se muestran
    setTienen(lj || [])
    setPerfiles(pr.data || [])
  }
  useEffect(() => { cargar() }, [])

  if (fallo) {
    return <p className="mut">No se pudieron cargar los logros. Comprueba que se ha ejecutado en Supabase el script 06_logros.sql.</p>
  }
  if (!cat) return <Cargando />

  const perfil = (jid: string) => perfiles.find((x) => x.id === jid)
  const misLogros = new Set(tienen.filter((t) => t.jugador_id === yo.id).map((t) => t.logro_id))
  const visibles = soloMios ? cat.filter((l) => misLogros.has(l.id)) : cat

  return (
    <>
      <div className="logros-cab">
        <span className="mut">Tienes <b>{misLogros.size}</b> de {cat.length}. Toca uno para ver quién lo tiene.</span>
        <button className={'sec mini' + (soloMios ? ' on2' : '')} onClick={() => setSoloMios(!soloMios)}>{soloMios ? 'Ver todos' : 'Solo los míos'}</button>
      </div>
      <div className="logros-lista">
        {visibles.map((l) => {
          const porJugador = new Map<string, number>()
          for (const t of tienen) if (t.logro_id === l.id) porJugador.set(t.jugador_id, (porJugador.get(t.jugador_id) || 0) + 1)
          const lista = [...porJugador.entries()]
            .filter(([jid]) => perfil(jid))
            .sort((a, b) => b[1] - a[1] || (perfil(a[0]).apodo || perfil(a[0]).nombre).localeCompare(perfil(b[0]).apodo || perfil(b[0]).nombre))
          const mio = porJugador.has(yo.id)
          const abiertoEste = abierto === l.id
          return (
            <div key={l.id} className={'logro' + (mio ? ' mio' : '') + (lista.length === 0 ? ' nadie' : '') + (abiertoEste ? ' abierto' : '')}>
              <button className="logro-fila" onClick={() => setAbierto(abiertoEste ? null : l.id)} aria-expanded={abiertoEste}>
                <span className="logro-ic">{l.icono}</span>
                <span className="logro-txt">
                  <b>{l.nombre}{mio && <span className="logro-check" aria-label="Lo tienes"> ✓</span>}</b>
                  <span className="mut">{l.descripcion}</span>
                </span>
                <span className="logro-quien">
                  {lista.length === 0 ? <span className="mut">Nadie</span> : (
                    <span className="pila-fotos">
                      {lista.slice(0, 3).map(([jid]) => <Avatar key={jid} p={perfil(jid)} size={22} />)}
                      {lista.length > 3 && <span className="avatar mas" style={{ width: 22, height: 22 }}>+{lista.length - 3}</span>}
                    </span>
                  )}
                </span>
              </button>
              {abiertoEste && (
                <div className="logro-det">
                  {lista.length === 0 ? <span className="mut">Nadie lo tiene todavía. ¿Serás el primero?</span> : lista.map(([jid, n]) => (
                    <span key={jid} className={'conv-jug clic' + (jid === yo.id ? ' yo' : '')} onClick={() => onFicha(jid)}>
                      <Avatar p={perfil(jid)} size={22} />{perfil(jid).apodo || perfil(jid).nombre}{n > 1 ? ` ×${n}` : ''}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {soloMios && visibles.length === 0 && <div className="vacio"><span>🏅</span><b>Aún no tienes ninguno</b><div className="mut">Juega tu primer partido y caerá el de Debutante.</div></div>}
      </div>
    </>
  )
}
