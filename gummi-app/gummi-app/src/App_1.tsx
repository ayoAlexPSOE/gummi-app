import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Jugadores from './Jugadores'
import Partidos from './Partidos'
import Votar from './Votar'

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
        <h2 style={{ marginTop: 60 }}>Gummi ⚽</h2>
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
  const [tab, setTab] = useState('partidos')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setYo(null); return }
    supabase.from('perfiles').select('*').eq('user_id', session.user.id).single()
      .then(({ data }) => setYo(data))
  }, [session])

  if (session === undefined) return <p className="c">Cargando…</p>
  if (!session) return <Login />

  return (
    <div className="app">
      <header>
        <b>Gummi ⚽</b>
        <span>{yo?.apodo || yo?.nombre}{yo?.rol === 'admin' ? ' · admin' : ''}</span>
        <button className="sec" onClick={() => supabase.auth.signOut()}>Salir</button>
      </header>
      <main>
        {!yo ? <p className="c">Cargando perfil…</p>
          : tab === 'partidos' ? <Partidos yo={yo} />
          : tab === 'votar' ? <Votar yo={yo} />
          : <Jugadores yo={yo} />}
      </main>
      <nav>
        <button className={tab === 'partidos' ? 'on' : ''} onClick={() => setTab('partidos')}>Partidos</button>
        <button className={tab === 'votar' ? 'on' : ''} onClick={() => setTab('votar')}>Votar</button>
        <button className={tab === 'jugadores' ? 'on' : ''} onClick={() => setTab('jugadores')}>Jugadores</button>
      </nav>
    </div>
  )
}
