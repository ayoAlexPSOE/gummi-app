import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Avatar from './Avatar'
import { aviso, confirmar } from './dialogos'
import { hace } from './util'
import { vibra } from './movil'

const MAX = 500

// Comentarios de un partido ya jugado: todos los ven; cada uno borra los suyos y el admin cualquiera.
export default function Comentarios({ partidoId, yo, perfiles }: { partidoId: number; yo: any; perfiles: any[] }) {
  const [lista, setLista] = useState<any[] | null>(null)
  const [falta, setFalta] = useState(false)
  const [texto, setTexto] = useState('')
  const [busy, setBusy] = useState(false)

  const cargar = async () => {
    const r = await supabase.from('comentarios').select('*').eq('partido_id', partidoId).order('created_at')
    if (r.error) { setFalta(true); return }
    setLista(r.data || [])
  }
  useEffect(() => { cargar() }, [partidoId])

  if (falta) return null // sin el script 18 no se muestra nada
  if (!lista) return null

  const perfil = (id: string) => perfiles.find((x) => x.id === id)
  const enviar = async (e: any) => {
    e.preventDefault()
    const t = texto.trim()
    if (!t) return
    setBusy(true)
    const { error } = await supabase.from('comentarios').insert({ partido_id: partidoId, autor_id: yo.id, texto: t.slice(0, MAX) })
    setBusy(false)
    if (error) return aviso('No se pudo publicar el comentario', 'error')
    vibra(15)
    setTexto('')
    cargar()
  }
  const borrar = async (id: number) => {
    if (!(await confirmar('¿Borrar este comentario?', { si: 'Borrar', peligro: true }))) return
    const { error } = await supabase.from('comentarios').delete().eq('id', id)
    if (error) return aviso('No se pudo borrar', 'error')
    setLista((l) => (l || []).filter((x) => x.id !== id))
  }

  return (
    <>
      <h2>💬 Comentarios{lista.length ? ` · ${lista.length}` : ''}</h2>
      <div className="card comentarios">
        {lista.length === 0 && <p className="mut mt0">Nadie ha dicho nada todavía. ¿Quién abre el debate?</p>}
        {lista.map((c) => {
          const a = perfil(c.autor_id)
          const puedeBorrar = c.autor_id === yo.id || yo.rol === 'admin'
          return (
            <div key={c.id} className={'comentario' + (c.autor_id === yo.id ? ' yo' : '')}>
              <Avatar p={a} size={30} />
              <div className="comentario-cuerpo">
                <div className="comentario-cab">
                  <b>{a ? a.apodo || a.nombre : 'Alguien'}</b>
                  <span className="mut">{hace(c.created_at)}</span>
                  {puedeBorrar && <button className="sec mini ico comentario-borrar" onClick={() => borrar(c.id)} aria-label="Borrar comentario">🗑️</button>}
                </div>
                <p className="comentario-texto">{c.texto}</p>
              </div>
            </div>
          )
        })}
        <form className="comentario-nuevo" onSubmit={enviar}>
          <textarea rows={2} maxLength={MAX} placeholder="Escribe un comentario…" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Comentario" />
          <div className="comentario-pie">
            <span className="mut fs12">{texto.length > MAX - 80 ? `${MAX - texto.length} caracteres` : ''}</span>
            <button type="submit" className="mini" disabled={busy || !texto.trim()}>{busy ? 'Enviando…' : 'Publicar'}</button>
          </div>
        </form>
      </div>
    </>
  )
}
