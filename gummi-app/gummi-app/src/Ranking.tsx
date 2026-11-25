import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Ficha from './Ficha'
import Logros from './Logros'

type Cat = {
  id: string
  titulo: string
  unidad: string
  valor: (r: any) => number | null
  nota?: string
  corto: string
  icono: string
}

const MIN_PARTIDOS = 3

const CATEGORIAS: Cat[] = [
  { id: 'goles', titulo: 'Goleadores', corto: 'Goles', icono: '⚽', unidad: 'goles', valor: (r) => r.goles },
  { id: 'asistencias', titulo: 'Asistentes', corto: 'Asist.', icono: '🅰️', unidad: 'asist.', valor: (r) => r.asistencias },
  { id: 'ga', titulo: 'Goles + asist.', corto: 'G+A', icono: '⚡', unidad: 'G+A', valor: (r) => r.goles + r.asistencias },
  { id: 'mvps', titulo: 'MVP', corto: 'MVP', icono: '🏆', unidad: 'MVP', valor: (r) => r.mvps },
  { id: 'victorias', titulo: 'Victorias', corto: 'Victorias', icono: '✅', unidad: 'victorias', valor: (r) => r.victorias },
  {
    id: 'pct',
    titulo: '% victorias',
    corto: '% Vict.',
    icono: '📈',
    unidad: '%',
    valor: (r) => (r.partidos >= MIN_PARTIDOS ? Math.round((100 * r.victorias) / r.partidos) : null),
    nota: `Hace falta haber jugado al menos ${MIN_PARTIDOS} partidos.`,
  },
  { id: 'partidos', titulo: 'Partidos', corto: 'Partidos', icono: '👟', unidad: 'partidos', valor: (r) => r.partidos },
]

const MEDALLAS = ['🥇', '🥈', '🥉']

export default function Ranking({ yo, vistaInicial }: { yo: any; vistaInicial?: string }) {
  const [vista, setVista] = useState(vistaInicial === 'logros' ? 'logros' : 'tabla')
  const [filas, setFilas] = useState<any[] | null>(null)
  const [cat, setCat] = useState('goles')
  const [ficha, setFicha] = useState<string | null>(null)
  const [fallo, setFallo] = useState(false)
  const [temporadas, setTemporadas] = useState<any[]>([])
  const [sel, setSel] = useState('') // id de temporada o 'todas'
  const [version, setVersion] = useState(0)
  const admin = yo.rol === 'admin'

  useEffect(() => {
    if (ficha !== null) return
    ;(async () => {
      const t = await supabase.from('temporadas').select('*').order('id', { ascending: false })
      const lista = t.data || []
      setTemporadas(lista)
      setSel((s) => s || String((lista.find((x: any) => x.activa) || lista[0])?.id ?? 'todas'))
    })()
  }, [ficha, version])

  useEffect(() => {
    if (ficha !== null || sel === '') return
    ;(async () => {
      const [pr, rk] = await Promise.all([
        supabase.from('perfiles').select('*').eq('activo', true),
        sel === 'todas'
          ? supabase.rpc('ranking_jugadores')
          : supabase.rpc('ranking_jugadores', { p_temporada: Number(sel) }),
      ])
      if (rk.error) {
        setFallo(true)
        return
      }
      setFallo(false)
      const porId: Record<string, any> = {}
      for (const r of rk.data || []) porId[r.jugador_id] = r
      setFilas(
        (pr.data || []).map((j: any) => ({
          ...j,
          ...(porId[j.id] || { partidos: 0, victorias: 0, empates: 0, derrotas: 0, goles: 0, asistencias: 0, mvps: 0 }),
        }))
      )
    })()
  }, [ficha, sel, version])

  const activa = temporadas.find((t) => t.activa)

  const nuevaTemporada = async () => {
    const nombre = prompt('Nombre de la nueva temporada (por ejemplo, 2026/27):')
    if (!nombre || !nombre.trim()) return
    const ok = confirm(
      `Se cerrará${activa ? ` "${activa.nombre}"` : ' la temporada actual'} y empezará "${nombre.trim()}". Los partidos que crees desde ahora irán a la nueva. ¿Seguro?`
    )
    if (!ok) return
    const { data, error } = await supabase.rpc('nueva_temporada', { p_nombre: nombre.trim() })
    if (error) return alert(error.message)
    setSel(String(data))
    setVersion((v) => v + 1)
  }

  if (ficha !== null) return <Ficha id={ficha} yo={yo} onBack={() => setFicha(null)} />
  const selectorVista = (
    <div className="row" style={{ margin: '12px 0 4px' }}>
      <button className={'sec' + (vista === 'tabla' ? ' on2' : '')} onClick={() => setVista('tabla')}>Clasificación</button>
      <button className={'sec' + (vista === 'logros' ? ' on2' : '')} onClick={() => setVista('logros')}>🏅 Logros</button>
    </div>
  )
  if (vista === 'logros') {
    return (
      <>
        {selectorVista}
        <Logros yo={yo} onFicha={(id) => setFicha(id)} />
      </>
    )
  }
  if (fallo) {
    return (
      <>
        {selectorVista}
        <h2>Ranking</h2>
        <p className="mut">No se pudo cargar el ranking. Comprueba que se han ejecutado en Supabase los scripts 04_ranking.sql y 05_temporadas.sql.</p>
      </>
    )
  }
  if (!filas) return <p className="c">Cargando…</p>

  const actual = CATEGORIAS.find((c) => c.id === cat) as Cat
  const ordenados = filas
    .map((r) => ({ r, v: actual.valor(r) }))
    .filter((x) => x.v !== null && (x.v > 0 || actual.id === 'pct'))
    .sort(
      (a, b) =>
        (b.v as number) - (a.v as number) ||
        b.r.partidos - a.r.partidos ||
        (a.r.apodo || a.r.nombre).localeCompare(b.r.apodo || b.r.nombre)
    )

  // Posición con empates: los que tienen el mismo valor comparten puesto.
  const puestos: number[] = []
  ordenados.forEach((x, i) => {
    puestos.push(i > 0 && ordenados[i - 1].v === x.v ? puestos[i - 1] : i + 1)
  })

  return (
    <>
      {selectorVista}
      <h2>Ranking</h2>
      <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ marginBottom: 10 }}>
        {temporadas.map((t) => (
          <option key={t.id} value={String(t.id)}>
            {t.nombre}{t.activa ? ' (actual)' : ''}
          </option>
        ))}
        <option value="todas">Histórico (todas)</option>
      </select>
      <div className="cats">
        {CATEGORIAS.map((c) => (
          <button key={c.id} className={'sec' + (cat === c.id ? ' on2' : '')} onClick={() => setCat(c.id)}>
            <span className="ic">{c.icono}</span>
            {c.corto}
          </button>
        ))}
      </div>
      <h2 style={{ marginTop: 14 }}>{actual.titulo}</h2>
      {actual.nota && <p className="mut">{actual.nota}</p>}

      {ordenados.length === 0 && (
        <p className="mut">Todavía no hay datos. Aparecerán al jugarse y cerrarse los primeros partidos.</p>
      )}
      {ordenados.map((x, i) => (
        <div className="card row" key={x.r.id} style={{ cursor: 'pointer' }} onClick={() => setFicha(x.r.id)}>
          <span style={{ width: 32, textAlign: 'center', fontWeight: 700 }}>
            {puestos[i] <= 3 ? MEDALLAS[puestos[i] - 1] : puestos[i]}
          </span>
          <span style={{ flex: 1 }}>
            <b>{x.r.apodo || x.r.nombre}</b>
            {x.r.es_externo && <span className="tag" style={{ marginLeft: 6 }}>externo</span>}
            <div className="mut">{x.r.partidos} PJ · {x.r.victorias}V {x.r.empates}E {x.r.derrotas}D</div>
          </span>
          <span style={{ fontSize: 22, fontWeight: 700 }}>
            {x.v}
            <span className="mut" style={{ fontSize: 12, fontWeight: 400 }}> {actual.unidad}</span>
          </span>
        </div>
      ))}

      {admin && (
        <div style={{ marginTop: 24 }}>
          <button className="sec" onClick={nuevaTemporada}>Empezar nueva temporada</button>
          <p className="mut">
            Cierra la temporada actual y abre otra. Las notas de los jugadores no se reinician; solo cambia el ranking.
          </p>
        </div>
      )}
    </>
  )
}
