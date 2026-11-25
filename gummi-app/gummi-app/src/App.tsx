import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Jugadores from './Jugadores'
import Partidos from './Partidos'
import Votar from './Votar'
import Ranking from './Ranking'
import Avisos from './Avisos'
import Inicio from './Inicio'
import Perfil from './Perfil'
import Avatar from './Avatar'

function Login() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')

  const entrar = async (e: any) => {
    e.preventDefault()
    const usuario = email.trim().toLowerCase()
    const correo = usuario.includes('@') ? usuario : `${usuario}@gummi.app`
    const { error } = await supabase.auth.signInWithPassword({ email: correo, password: pass })
    if (error) setErr('Usuario o contraseña incorrectos')
  }

  return (
    <div className="app">
      <main>
        <div className="brand-big">GUMMI<i>⚽</i></div>
        <p className="mut">Inicia sesión con la cuenta que te ha creado el admin.</p>
        <form onSubmit={entrar}>
          <input placeholder="Usuario" autoCapitalize="none" autoCorrect="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Contraseña" value={pass} onChange={(e) => setPass(e.target.value)} />
          {err && <div className="err">{err}</div>}
          <button type="submit">Entrar</button>
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

  const contarAvisos = async () => {
    const { count, error } = await supabase
      .from('notificaciones').select('id', { count: 'exact', head: true }).eq('leida', false)
    if (!error) setSinLeer(count || 0)
  }

  // Mantenimiento (logros, avisos por tiempo) y contador de avisos, cada minuto.
  useEffect(() => {
    if (!yo) return
    let vivo = true
    const ciclo = async () => {
      try { await supabase.rpc('mantenimiento') } catch { /* si el SQL aún no está, se ignora */ }
      if (vivo) await contarAvisos()
    }
    ciclo()
    const t = setInterval(ciclo, 60000)
    return () => { vivo = false; clearInterval(t) }
  }, [yo?.id])

  const irA = (destino: string | null, ref: number | null) => {
    if (destino === 'partido' && ref) { setIrPartido(ref); setTab('partidos') }
    else if (destino === 'votar') setTab('votar')
    else if (destino === 'logros') { setVistaRanking('logros'); setTab('ranking') }
    else setTab('partidos')
  }

  if (session === undefined) return <p className="c">Cargando…</p>
  if (!session) return <Login />

  return (
    <div className="app">
      <header>
        <b className="brand">GUMMI<i>⚽</i></b>
        <span className="quien" style={{ cursor: 'pointer' }} onClick={() => setTab('perfil')}>
          <b>{yo?.apodo || yo?.nombre}{yo?.rol === 'admin' ? ' · admin' : ''}</b>
          <Avatar p={yo} size={32} />
        </span>
        <button className="bell" onClick={() => setTab('avisos')} aria-label="Avisos">
          🔔{sinLeer > 0 && <span className="badge">{sinLeer}</span>}
        </button>
      </header>
      <main>
        {!yo ? <p className="c">Cargando perfil…</p>
          : tab === 'inicio' ? <Inicio yo={yo} onPartido={(id) => irA('partido', id)} onVotar={() => setTab('votar')} />
          : tab === 'partidos' ? <Partidos yo={yo} abrirInicial={irPartido} onUsado={() => setIrPartido(null)} />
          : tab === 'perfil' ? <Perfil yo={yo} onGuardado={cargarYo} />
          : tab === 'avisos' ? <Avisos onIr={irA} onCambio={contarAvisos} />
          : tab === 'votar' ? <Votar yo={yo} />
          : tab === 'ranking' ? <Ranking key={vistaRanking} yo={yo} vistaInicial={vistaRanking} />
          : <Jugadores yo={yo} />}
      </main>
      <nav>
        {([['inicio', '🏠', 'Inicio'], ['partidos', '⚽', 'Partidos'], ['votar', '🗳️', 'Votar'], ['ranking', '🏆', 'Ranking'], ['jugadores', '👥', 'Plantilla']] as const).map(([id, ic, tx]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => { if (id === 'ranking') setVistaRanking('tabla'); setTab(id) }}>
            <span className="ic">{ic}</span>{tx}
          </button>
        ))}
      </nav>
    </div>
  )
}
