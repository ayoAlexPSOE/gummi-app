// Avisos y preguntas propios de la app (en lugar de las ventanas del navegador).
//   aviso('Guardado')                       -> mensajito arriba que se va solo
//   aviso('No se pudo…', 'error')
//   if (!(await confirmar('¿Seguro?'))) return
//   const nombre = await pedirTexto('Nombre…')
import { useEffect, useRef, useState } from 'react'

type Toast = { id: number; texto: string; tipo: 'ok' | 'error' | 'info' }
type Pregunta = { texto: string; si: string; no: string; peligro?: boolean; campo?: { placeholder?: string; valor?: string }; responder: (v: any) => void }

let ponerToast: ((t: Toast) => void) | null = null
let ponerPregunta: ((p: Pregunta | null) => void) | null = null
let siguiente = 1

export function aviso(texto: string, tipo: Toast['tipo'] = 'info') {
  if (ponerToast) ponerToast({ id: siguiente++, texto, tipo })
  else window.alert(texto)
}

export function confirmar(texto: string, op: { si?: string; no?: string; peligro?: boolean } = {}): Promise<boolean> {
  if (!ponerPregunta) return Promise.resolve(window.confirm(texto))
  return new Promise((ok) => ponerPregunta!({ texto, si: op.si || 'Sí', no: op.no || 'Cancelar', peligro: op.peligro, responder: ok }))
}

export function pedirTexto(texto: string, op: { placeholder?: string; valor?: string; si?: string } = {}): Promise<string | null> {
  if (!ponerPregunta) return Promise.resolve(window.prompt(texto, op.valor))
  return new Promise((ok) => ponerPregunta!({ texto, si: op.si || 'Aceptar', no: 'Cancelar', campo: { placeholder: op.placeholder, valor: op.valor }, responder: ok }))
}

export function Dialogos() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [preg, setPreg] = useState<Pregunta | null>(null)
  const [valor, setValor] = useState('')
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ponerToast = (t) => {
      setToasts((ts) => [...ts.slice(-2), t])
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== t.id)), t.tipo === 'error' ? 5000 : 3000)
    }
    ponerPregunta = (p) => { setPreg(p); setValor(p?.campo?.valor || '') }
    return () => { ponerToast = null; ponerPregunta = null }
  }, [])
  useEffect(() => { if (preg?.campo) setTimeout(() => campo.current?.focus(), 50) }, [preg])

  const cerrar = (v: any) => { preg?.responder(v); setPreg(null) }

  return (
    <>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={'toast-item ' + t.tipo}>{t.texto}</div>)}
      </div>
      {preg && (
        <div className="modal-fondo" onClick={() => cerrar(preg.campo ? null : false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p className="modal-texto">{preg.texto}</p>
            {preg.campo && (
              <input ref={campo} value={valor} placeholder={preg.campo.placeholder} onChange={(e) => setValor(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && valor.trim()) cerrar(valor) }} />
            )}
            <div className="modal-botones">
              <button className="sec" onClick={() => cerrar(preg.campo ? null : false)}>{preg.no}</button>
              <button className={preg.peligro ? 'peligro-lleno' : ''} disabled={!!preg.campo && !valor.trim()} onClick={() => cerrar(preg.campo ? valor : true)}>{preg.si}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
