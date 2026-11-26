import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import Jugadores from './Jugadores'
import Partidos, { olvidarPartido } from './Partidos'
import Votar from './Votar'
import Ranking from './Ranking'
import Avisos from './Avisos'
import Inicio from './Inicio'
import Perfil from './Perfil'
import Admin from './Admin'
import Avatar from './Avatar'
import { Cargando, useAtras } from './movil'
import { refrescarSuscripcion } from './push'

function Login() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const entrar = async (e: any) => {
    e.preventDefault()
    const usuario = email.trim().toLowerCase()
    if (!usuario || !pass) return setErr('Escribe tu usuario y contraseña')
    const correo = usuario.includes('@') ? usuario : `${usuario}@gummi.app`
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: correo, password: pass })
    setBusy(false)
    if (error) setErr(/fetch|network/i.test(error.message) ? 'Sin conexión. Inténtalo de nuevo.' : 'Usuario o contraseña incorrectos')
  }

  return (
    <div className="app">
      <main className="vista login">
        <div className="brand-big"><span className="brand-tx">GUMMI</span><i>⚽</i></div>
        <p className="mut">Inicia sesión con la cuenta que te ha creado el admin.</p>
        <form onSubmit={entrar}>
          <input placeholder="Usuario" autoCapitalize="none" autoCorrect="off" autoComplete="username" name="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Contraseña" autoComplete="current-password" name="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          {err && <div className="err" key={err + Date.now()}>{err}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </main>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<any>(undefined)
  const [yo, setYo] = useState<any>(null)
  const [tab, setTab] = useState('inicio')
  const [sinLeer, setSinLeer] = useState(0)
  const [irPartido, setIrPartido] = useState<number | null>(null)
  const [vistaRanking, setVistaRanking] = useState('tabla')
  const [vuelta, setVuelta] = useState(0) // al cambiar, la pantalla actual se recarga
  const [tirando, setTirando] = useState(0) // 0-1: cuánto se ha tirado hacia abajo para refrescar
  const oculto = useRef(0)

  // "Atrás" en el móvil: desde cualquier pestaña vuelve a Inicio en vez de salir de la web.
  useAtras(tab !== 'inicio', () => { olvidarPartido(); setTab('inicio') })

  // Tocar la pestaña en la que ya estás: si has bajado, sube arriba; si no, vuelve a su pantalla principal.
  const irTab = (t: string) => {
    if (t === tab) {
      if (window.scrollY > 40) window.scrollTo({ top: 0, behavior: 'smooth' })
      else { olvidarPartido(); setVuelta((v) => v + 1) }
      return
    }
    olvidarPartido()
    setTab(t)
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const cargarYo = async () => {
    if (!session) return
    const { data } = await supabase.from('perfiles').select('*').eq('user_id', session.user.id).single()
    setYo(data)
  }
  useEffect(() => {
    if (!session) { setYo(null); return }
    cargarYo()
  }, [session])

  // Al entrar: el móvil queda apuntado a esta cuenta para los avisos
  useEffect(() => { if (yo?.id) refrescarSuscripcion() }, [yo?.id])

  // Globito con el número de avisos en el icono de la app (donde el móvil lo permite)
  useEffect(() => {
    const n: any = navigator
    try { if (sinLeer > 0) n.setAppBadge?.(sinLeer); else n.clearAppBadge?.() } catch { /* sin soporte */ }
  }, [sinLeer])

  // Al tocar un aviso del móvil se abre la app en la pantalla del aviso
  const abrirDesdeAviso = (url: string) => {
    const q = new URL(url, location.href).searchParams
    const ir = q.get('ir'), ref = q.get('ref'), aviso = q.get('aviso')
    if (!ir && !aviso) return
    if (aviso) supabase.from('notificaciones').update({ leida: true }).eq('id', Number(aviso)).then(() => contarAvisos())
    if (ir) irA(ir, ref ? Number(ref) : null)
    else { window.scrollTo(0, 0); setTab('avisos') }
  }
  useEffect(() => {
    if (!yo) return
    if (location.search.includes('ir=') || location.search.includes('aviso=')) {
      abrirDesdeAviso(location.href)
      history.replaceState(history.state, '', location.pathname)
    }
    const msg = (e: MessageEvent) => { if (e.data?.tipo === 'abrir') abrirDesdeAviso(e.data.url) }
    navigator.serviceWorker?.addEventListener('message', msg)
    return () => navigator.serviceWorker?.removeEventListener('message', msg)
  }, [yo?.id])

  const contarAvisos = async () => {
    const { count, error } = await supabase
      .from('notificaciones').select('id', { count: 'exact', head: true }).eq('leida', false)
    if (!error) setSinLeer(count || 0)
  }

  // Mantenimiento (logros, avisos por tiempo) y contador de avisos, cada minuto,
  // solo mientras la app está a la vista (con el móvil bloqueado no gasta batería ni datos).
  useEffect(() => {
    if (!yo) return
    let vivo = true
    const ciclo = async () => {
      if (document.hidden) return
      try { await supabase.rpc('mantenimiento') } catch { /* si el SQL aún no está, se ignora */ }
      if (vivo) await contarAvisos()
    }
    ciclo()
    const t = setInterval(ciclo, 60000)
    // Al volver a la app tras un rato fuera, se ponen los datos al día.
    const cambio = () => {
      if (document.hidden) { oculto.current = Date.now(); return }
      if (oculto.current && Date.now() - oculto.current > 60000) { setVuelta((v) => v + 1); ciclo() }
      oculto.current = 0
    }
    document.addEventListener('visibilitychange', cambio)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', cambio) }
  }, [yo?.id])

  // Tirar hacia abajo desde arriba del todo para refrescar (como en las apps).
  useEffect(() => {
    if (!yo) return
    let y0 = -1
    let k = 0
    const ini = (e: TouchEvent) => { y0 = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : -1; k = 0 }
    const mov = (e: TouchEvent) => {
      if (y0 < 0) return
      const dy = e.touches[0].clientY - y0
      if (dy <= 0 || window.scrollY > 0) { if (k) { k = 0; setTirando(0) } return }
      const nk = Math.min(1, dy / 110)
      if (Math.abs(nk - k) > 0.04 || nk === 1) { k = nk; setTirando(nk) }
    }
    const fin = () => {
      if (y0 >= 0 && k >= 1) { setVuelta((v) => v + 1); contarAvisos(); try { navigator.vibrate?.(10) } catch { /* */ } }
      y0 = -1; k = 0; setTirando(0)
    }
    window.addEventListener('touchstart', ini, { passive: true })
    window.addEventListener('touchmove', mov, { passive: true })
    window.addEventListener('touchend', fin)
    window.addEventListener('touchcancel', fin)
    return () => {
      window.removeEventListener('touchstart', ini)
      window.removeEventListener('touchmove', mov)
      window.removeEventListener('touchend', fin)
      window.removeEventListener('touchcancel', fin)
    }
  }, [yo?.id])

  const irA = (destino: string | null, ref: number | null) => {
    window.scrollTo(0, 0)
    if (destino === 'partido' && ref) { setIrPartido(ref); setTab('partidos') }
    else if (destino === 'votar') setTab('votar')
    else if (destino === 'logros') { setVistaRanking('logros'); setTab('ranking') }
    else setTab('partidos')
  }

  if (session === undefined) return <Cargando />
  if (!session) return <Login />

  return (
    <div className="app">
      <header>
        <b className="brand"><span className="brand-tx">GUMMI</span><i>⚽</i></b>
        <span className="quien" style={{ cursor: 'pointer' }} onClick={() => irTab('perfil')}>
          <b>{yo?.apodo || yo?.nombre}{yo?.rol === 'admin' ? ' · admin' : ''}</b>
          <Avatar p={yo} size={32} />
        </span>
        <button className="bell" onClick={() => irTab('avisos')} aria-label={sinLeer > 0 ? `Avisos (${sinLeer} sin leer)` : 'Avisos'}>
          🔔{sinLeer > 0 && <span className="badge">{sinLeer}</span>}
        </button>
      </header>
      {tirando > 0 && (
        <div className={'tirar' + (tirando >= 1 ? ' listo' : '')} style={{ transform: `translate(-50%, ${Math.round(tirando * 56)}px) rotate(${Math.round(tirando * 300)}deg)`, opacity: tirando }}>⚽</div>
      )}
      <main key={tab + ':' + vuelta} className="vista">
        {!yo ? <Cargando texto="Cargando perfil…" />
          : tab === 'inicio' ? <Inicio yo={yo} onPartido={(id) => irA('partido', id)} onVotar={() => irTab('votar')} />
          : tab === 'partidos' ? <Partidos yo={yo} abrirInicial={irPartido} onUsado={() => setIrPartido(null)} />
          : tab === 'perfil' ? <Perfil yo={yo} onGuardado={cargarYo} onAdmin={() => irTab('admin')} />
          : tab === 'admin' && yo.rol === 'admin' ? <Admin yo={yo} onBack={() => irTab('perfil')} onPartido={(id) => irA('partido', id)} onTab={irTab} />
          : tab === 'avisos' ? <Avisos onIr={irA} onCambio={contarAvisos} />
          : tab === 'votar' ? <Votar yo={yo} />
          : tab === 'ranking' ? <Ranking key={vistaRanking} yo={yo} vistaInicial={vistaRanking} />
          : <Jugadores yo={yo} />}
      </main>
      <nav>
        {([['inicio', '🏠', 'Inicio'], ['partidos', '⚽', 'Partidos'], ['votar', '🗳️', 'Votar'], ['ranking', '🏆', 'Ranking'], ['jugadores', '👥', 'Plantilla']] as const).map(([id, ic, tx]) => (
          <button key={id} className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => { if (id === 'ranking' && tab !== 'ranking') setVistaRanking('tabla'); irTab(id) }}>
            <span className="ic">{ic}</span>{tx}
          </button>
        ))}
      </nav>
    </div>
  )
}
