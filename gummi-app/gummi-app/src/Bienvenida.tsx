import { useRef, useState } from 'react'
import { supabase } from './supabase'
import Avatar from './Avatar'
import { reducir } from './Perfil'
import { POSICIONES } from './equipos'
import { TarjetaAvisos } from './push'
import { aviso } from './dialogos'
import { vibra } from './movil'
import logo from './logo.webp'

// Primer acceso: contraseña propia, nombre en la app, foto, posición y avisos.
export default function Bienvenida({ yo, onListo }: { yo: any; onListo: () => void }) {
  const [paso, setPaso] = useState(0)
  const [busy, setBusy] = useState(false)
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [apodo, setApodo] = useState(yo.apodo || '')
  const [foto, setFoto] = useState<string | null>(yo.foto_url || null)
  const [pos, setPos] = useState<string>(yo.posicion || '')
  const [dorsal, setDorsal] = useState<string>(yo.dorsal != null ? String(yo.dorsal) : '')
  const fileRef = useRef<HTMLInputElement>(null)
  const extras = yo.foto_url !== undefined
  const PASOS = ['Contraseña', 'Tu nombre', 'Tu posición', 'Avisos']

  const siguiente = () => { vibra(10); setPaso((n) => n + 1); window.scrollTo(0, 0) }

  const guardarPass = async () => {
    if (p1.length < 6) return aviso('La contraseña tiene que tener al menos 6 caracteres', 'error')
    if (p1 !== p2) return aviso('Las dos contraseñas no coinciden', 'error')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: p1 })
    setBusy(false)
    if (error && !/different from the old/i.test(error.message)) return aviso('No se pudo cambiar: ' + error.message, 'error')
    siguiente()
  }

  const subirFoto = async (e: any) => {
    const f: File | undefined = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true)
    try {
      const blob = await reducir(f)
      const ruta = `${yo.id}/avatar.jpg`
      const up = await supabase.storage.from('avatares').upload(ruta, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
      if (up.error) throw up.error
      const url = supabase.storage.from('avatares').getPublicUrl(ruta).data.publicUrl + '?v=' + Date.now()
      const { error } = await supabase.from('perfiles').update({ foto_url: url }).eq('id', yo.id)
      if (error) throw error
      setFoto(url)
    } catch { aviso('No se pudo subir la foto', 'error') }
    setBusy(false)
  }

  const guardarNombre = async () => {
    const a = apodo.trim()
    if (!a) return aviso('Escribe cómo quieres que te vean', 'error')
    setBusy(true)
    const { error } = await supabase.from('perfiles').update({ apodo: a, nombre: a }).eq('id', yo.id)
    setBusy(false)
    if (error) return aviso(error.message, 'error')
    siguiente()
  }

  const guardarPos = async () => {
    setBusy(true)
    const cambios: any = { posicion: pos || null }
    if (extras) cambios.dorsal = dorsal === '' ? null : Math.max(0, Math.min(99, Number(dorsal)))
    const { error } = await supabase.from('perfiles').update(cambios).eq('id', yo.id)
    setBusy(false)
    if (error) return aviso(error.message, 'error')
    siguiente()
  }

  const terminar = async () => {
    setBusy(true)
    await supabase.from('perfiles').update({ bienvenida: new Date().toISOString() }).eq('id', yo.id)
    setBusy(false)
    vibra(30)
    onListo()
  }

  const vistaPrevia = { ...yo, apodo, foto_url: foto }

  return (
    <div className="bienvenida">
      <img className="bienv-logo" src={logo} alt="Gummi" />
      <div className="bienv-pasos" aria-label={`Paso ${paso + 1} de ${PASOS.length}`}>
        {PASOS.map((t, i) => <span key={t} className={i < paso ? 'hecho' : i === paso ? 'actual' : ''} />)}
      </div>

      <div className="bienv-card" key={paso}>
        {paso === 0 && (
          <>
            <h1>¡Bienvenido a la peña! 👋</h1>
            <p className="mut">Primero, pon una contraseña tuya en lugar de la que te dieron.</p>
            <input type="password" autoComplete="new-password" placeholder="Nueva contraseña" value={p1} onChange={(e) => setP1(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder="Repite la contraseña" value={p2} onChange={(e) => setP2(e.target.value)} />
            <button className="w100" disabled={busy || !p1 || !p2} onClick={guardarPass}>Guardar y seguir</button>
          </>
        )}

        {paso === 1 && (
          <>
            <h1>¿Cómo te llamamos?</h1>
            <p className="mut">Es el nombre que verán todos en la app (tu usuario para entrar no cambia).</p>
            <div className="bienv-foto">
              <button type="button" className="bienv-avatar" onClick={() => extras && fileRef.current?.click()} disabled={!extras || busy} aria-label="Poner foto">
                <Avatar p={vistaPrevia} size={96} />
                {extras && <span className="bienv-cam">📷</span>}
              </button>
              {extras && <span className="mut fs12">{foto ? 'Toca para cambiarla' : 'Toca para poner foto'}</span>}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={subirFoto} />
            </div>
            <input placeholder="Tu nombre o apodo" maxLength={24} value={apodo} onChange={(e) => setApodo(e.target.value)} />
            <button className="w100" disabled={busy || !apodo.trim()} onClick={guardarNombre}>Seguir</button>
          </>
        )}

        {paso === 2 && (
          <>
            <h1>¿Dónde juegas?</h1>
            <p className="mut">Sirve para hacer equipos equilibrados. Lo puedes cambiar luego en tu perfil.</p>
            <div className="pos-grid">
              {POSICIONES.map(([id, t, ic]) => (
                <button key={id} type="button" className={'sec' + (pos === id ? ' on2' : '')} onClick={() => setPos(pos === id ? '' : id)}>
                  <span className="fs20">{ic}</span>{t}
                </button>
              ))}
            </div>
            {extras && (
              <label className="bienv-dorsal">
                <span className="mut">Dorsal (opcional)</span>
                <input type="number" inputMode="numeric" min={0} max={99} placeholder="—" value={dorsal} onChange={(e) => setDorsal(e.target.value.slice(0, 2))} />
              </label>
            )}
            <button className="w100" disabled={busy} onClick={guardarPos}>{pos ? 'Seguir' : 'Saltar por ahora'}</button>
          </>
        )}

        {paso === 3 && (
          <>
            <h1>Último paso: los avisos</h1>
            <p className="mut">Te avisamos de partidos, equipos, votaciones y MVP aunque tengas la app cerrada.</p>
            <TarjetaAvisos />
            <button className="w100" disabled={busy} onClick={terminar}>¡Vamos! ⚽</button>
          </>
        )}
      </div>

      {paso > 0 && paso < 3 && <button className="sec mini bienv-atras" onClick={() => setPaso(paso - 1)}>← Atrás</button>}
    </div>
  )
}
