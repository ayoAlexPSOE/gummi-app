import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { aviso, confirmar } from './dialogos'
import { invalidar, ranking } from './datos'
import Numero from './Numero'
import Avatar from './Avatar'
import Ficha from './Ficha'
import { useAtras, vibra } from './movil'
import { POSICIONES, nombrePos } from './equipos'
import { TarjetaAvisos } from './push'

const POS = POSICIONES
const PIERNAS: [string, string][] = [['derecha', 'Derecha'], ['izquierda', 'Izquierda'], ['ambas', 'Ambas']]

// Recorta al cuadrado y reduce a 320 px para que la foto pese poco.
async function reducir(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const lado = Math.min(bmp.width, bmp.height)
  const c = document.createElement('canvas')
  c.width = c.height = 320
  const ctx = c.getContext('2d') as CanvasRenderingContext2D
  ctx.drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, 320, 320)
  return new Promise((ok, ko) =>
    c.toBlob((b) => (b ? ok(b) : ko(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.85)
  )
}

export default function Perfil({ yo, onGuardado, onAdmin }: { yo: any; onGuardado: () => void; onAdmin?: () => void }) {
  const extras = yo.foto_url !== undefined // false si aún no se ha ejecutado 11_perfil.sql
  const [nombre, setNombre] = useState(yo.nombre || '')
  const [apodo, setApodo] = useState(yo.apodo || '')
  const [pos, setPos] = useState<string>(yo.posicion || '')
  const [sec, setSec] = useState<string[]>(yo.posiciones_secundarias || [])
  const [dorsal, setDorsal] = useState(yo.dorsal != null ? String(yo.dorsal) : '')
  const [pierna, setPierna] = useState<string>(yo.pierna || '')
  const [busy, setBusy] = useState(false)
  const [stats, setStats] = useState<any>(null)
  const [logros, setLogros] = useState<any[]>([])
  const [ficha, setFicha] = useState(false)
  const [pass1, setPass1] = useState('')
  const [pass2, setPass2] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useAtras(ficha, () => setFicha(false))

  useEffect(() => {
    if (ficha) return
    ;(async () => {
      const rk = await ranking()
      setStats((rk.data || []).find((r: any) => r.jugador_id === yo.id) || { partidos: 0, victorias: 0, empates: 0, derrotas: 0, goles: 0, asistencias: 0, mvps: 0 })
      const [lg, lj] = await Promise.all([
        supabase.from('logros').select('*').order('orden'),
        supabase.from('logros_jugador').select('*').eq('jugador_id', yo.id),
      ])
      const sal: any[] = []
      for (const l of lg.data || []) {
        const n = (lj.data || []).filter((x: any) => x.logro_id === l.id).length
        if (n > 0) sal.push({ ...l, n })
      }
      setLogros(sal)
    })()
  }, [ficha])

  const avisar = (t: string) => aviso(t, t.startsWith('✅') ? 'ok' : 'error')

  const guardar = async () => {
    if (!nombre.trim()) return avisar('El nombre no puede estar vacío')
    const d = dorsal.trim()
    if (d !== '' && !(Number(d) >= 0 && Number(d) <= 99 && Number.isInteger(Number(d)))) return avisar('El dorsal va de 0 a 99')
    setBusy(true)
    const cambios: any = { nombre: nombre.trim(), apodo: apodo.trim() || null, posicion: pos || null }
    if (extras) {
      cambios.posiciones_secundarias = sec.filter((s) => s !== pos)
      cambios.dorsal = d === '' ? null : Number(d)
      cambios.pierna = pierna || null
    }
    const { error } = await supabase.from('perfiles').update(cambios).eq('id', yo.id)
    setBusy(false)
    if (error) return avisar('No se pudo guardar: ' + error.message)
    vibra(20)
    avisar('✅ Perfil guardado')
    invalidar('perfiles'); onGuardado()
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
      avisar('✅ Foto actualizada')
      invalidar('perfiles'); onGuardado()
    } catch (err: any) {
      avisar('No se pudo subir la foto: ' + (err?.message || 'error'))
    }
    setBusy(false)
  }

  const quitarFoto = async () => {
    if (!(await confirmar('¿Quitar tu foto?', { si: 'Quitar', peligro: true }))) return
    setBusy(true)
    await supabase.storage.from('avatares').remove([`${yo.id}/avatar.jpg`])
    const { error } = await supabase.from('perfiles').update({ foto_url: null }).eq('id', yo.id)
    setBusy(false)
    if (error) return avisar(error.message)
    invalidar('perfiles'); onGuardado()
  }

  const cambiarPass = async () => {
    if (pass1.length < 6) return avisar('La contraseña debe tener al menos 6 caracteres')
    if (pass1 !== pass2) return avisar('Las contraseñas no coinciden')
    const { error } = await supabase.auth.updateUser({ password: pass1 })
    if (error) return avisar(error.message)
    setPass1(''); setPass2('')
    avisar('✅ Contraseña cambiada')
  }

  if (ficha) return <Ficha id={yo.id} yo={yo} onBack={() => setFicha(false)} />

  const pct = stats && stats.partidos > 0 ? Math.round((100 * stats.victorias) / stats.partidos) : null
  const T = ({ v, t }: { v: any; t: string }) => (
    <div className="tile"><b>{typeof v === 'number' ? <Numero v={v} /> : (v ?? '–')}</b><span className="mut">{t}</span></div>
  )

  return (
    <>

      <div className="perfil-cab">
        <Avatar p={yo} size={96} />
        <div className="f1 min0">
          <div className="perfil-nombre">{yo.apodo || yo.nombre}</div>
          {yo.apodo && <div className="mut">{yo.nombre}</div>}
          <div className="row mt6">
            {yo.posicion && <span className={'tag pos-' + yo.posicion}>{nombrePos(yo.posicion)}</span>}
            {(yo.posiciones_secundarias || []).map((s: string) => <span key={s} className={'tag o70 pos-' + s}>{nombrePos(s)}</span>)}
            {yo.rol === 'admin' && (
              <button type="button" className="tag admin-tag" onClick={onAdmin}>🔧 admin ›</button>
            )}
          </div>
        </div>
        <div className="perfil-info">
          {yo.dorsal != null && <div className="dorsal">{yo.dorsal}</div>}
          <div>Socio desde {new Date(yo.created_at).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}</div>
          {stats && stats.partidos > 0 && <div>⚽ {(stats.goles / stats.partidos).toFixed(2)} goles/partido</div>}
          {stats && stats.partidos > 0 && <div>🏆 {Math.round((100 * stats.victorias) / stats.partidos)}% victorias</div>}
          {yo.pierna && <div>🦶 Pierna {yo.pierna}</div>}
          {logros.length > 0 && <div>🏅 {logros.length} logros</div>}
        </div>
      </div>

      {extras && (
        <div className="row" style={{ margin: '4px 0 10px' }}>
          <button className="sec mini" disabled={busy} onClick={() => fileRef.current?.click()}>📷 {yo.foto_url ? 'Cambiar foto' : 'Subir foto'}</button>
          {yo.foto_url && <button className="sec mini" disabled={busy} onClick={quitarFoto}>Quitar</button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={subirFoto} />
        </div>
      )}
      {!extras && (
        <p className="mut">Para poder poner foto, dorsal y posiciones extra, el admin tiene que ejecutar en Supabase el script 11_perfil.sql.</p>
      )}

      <h2>Mis números</h2>
      {stats && (
        <>
          <div className="grid4">
            <T v={stats.partidos} t="PJ" />
            <T v={stats.victorias} t="V" />
            <T v={stats.empates} t="E" />
            <T v={stats.derrotas} t="D" />
          </div>
          <div className="grid3 mt8">
            <T v={stats.goles} t="Goles" />
            <T v={stats.asistencias} t="Asist." />
            <T v={stats.mvps} t="MVP" />
          </div>
          {pct !== null && <p className="mut">{pct}% de victorias</p>}
        </>
      )}

      {logros.length > 0 && (
        <div className="card">
          <b>🏅 Mis logros ({logros.length})</b>
          <div className="row mt8">
            {logros.map((l) => (
              <span key={l.id} className="tag" title={l.descripcion}>{l.icono} {l.nombre}{l.n > 1 ? ` ×${l.n}` : ''}</span>
            ))}
          </div>
        </div>
      )}
      <button className="sec w100 mt6" onClick={() => setFicha(true)}>Ver mi ficha completa ›</button>

      <h2>Avisos</h2>
      <TarjetaAvisos />

      <h2>Mis datos</h2>
      <div className="card">
        <form onSubmit={(e) => { e.preventDefault(); guardar() }}>
          <label className="mut">Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <label className="mut">Apodo (es el que verán los demás)</label>
          <input value={apodo} onChange={(e) => setApodo(e.target.value)} placeholder="Opcional" />

          <label className="mut">Posición principal (la usa el generador de equipos)</label>
          <div className="pos-grid">
            {POS.map(([id, t, ic]) => (
              <button type="button" key={id} className={'sec' + (pos === id ? ' on2' : '')} onClick={() => setPos(pos === id ? '' : id)}>
                <span className="fs20">{ic}</span>{t}
              </button>
            ))}
          </div>

          {extras && (
            <>
              <label className="mut">También puedo jugar de…</label>
              <div className="pos-grid">
                {POS.filter(([id]) => id !== pos).map(([id, t, ic]) => (
                  <button type="button" key={id} className={'sec' + (sec.includes(id) ? ' on2' : '')}
                    onClick={() => setSec(sec.includes(id) ? sec.filter((x) => x !== id) : [...sec, id])}>
                    <span className="fs20">{ic}</span>{t}
                  </button>
                ))}
              </div>
              <label className="mut">Dorsal</label>
              <input inputMode="numeric" value={dorsal} onChange={(e) => setDorsal(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="Ej. 10" />
              <label className="mut">Pierna buena</label>
              <div className="row">
                {PIERNAS.map(([id, t]) => (
                  <button type="button" key={id} className={'sec' + (pierna === id ? ' on2' : '')} onClick={() => setPierna(pierna === id ? '' : id)}>{t}</button>
                ))}
              </div>
            </>
          )}
          <button type="submit" disabled={busy} className="mt6">Guardar cambios</button>
        </form>
      </div>

      <details className="card">
        <summary>🔒 Cambiar contraseña</summary>
        <form className="mt10" onSubmit={(e) => { e.preventDefault(); cambiarPass() }}>
          <input type="password" autoComplete="new-password" placeholder="Nueva contraseña" value={pass1} onChange={(e) => setPass1(e.target.value)} />
          <input type="password" autoComplete="new-password" placeholder="Repite la contraseña" value={pass2} onChange={(e) => setPass2(e.target.value)} />
          <button type="submit">Cambiar contraseña</button>
        </form>
      </details>

      <button className="sec w100 mt14" onClick={async () => { if (await confirmar('¿Cerrar sesión en este móvil?', { si: 'Cerrar sesión' })) supabase.auth.signOut() }}>Cerrar sesión</button>
    </>
  )
}
