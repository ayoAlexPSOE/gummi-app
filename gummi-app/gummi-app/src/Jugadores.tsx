import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export default function Jugadores({ yo }: { yo: any }) {
  const admin = yo.rol === 'admin'
  const [lista, setLista] = useState<any[]>([])
  const [nombre, setNombre] = useState('')
  const [pos, setPos] = useState('')

  const cargar = async () => {
    const { data } = await supabase.from('perfiles').select('*').order('nombre')
    setLista(data || [])
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

  return (
    <>
      <h2>Jugadores ({lista.length})</h2>
      {lista.map((j) => (
        <div className="card row" key={j.id}>
          <b style={{ flex: 1 }}>{j.apodo || j.nombre}</b>
          {j.posicion && <span className="tag">{j.posicion}</span>}
          {j.es_externo && <span className="tag">externo</span>}
          {j.rol === 'admin' && <span className="tag">admin</span>}
        </div>
      ))}
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
