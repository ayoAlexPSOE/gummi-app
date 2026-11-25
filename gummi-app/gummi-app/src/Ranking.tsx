import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Ficha from './Ficha'

type Cat = {
  id: string
  titulo: string
  unidad: string
  valor: (r: any) => number | null
  nota?: string
}

const MIN_PARTIDOS = 3

const CATEGORIAS: Cat[] = [
  { id: 'goles', titulo: 'Goleadores', unidad: 'goles', valor: (r) => r.goles },
  { id: 'asistencias', titulo: 'Asistentes', unidad: 'asist.', valor: (r) => r.asistencias },
  { id: 'ga', titulo: 'Goles + asist.', unidad: 'G+A', valor: (r) => r.goles + r.asistencias },
  { id: 'mvps', titulo: 'MVP', unidad: 'MVP', valor: (r) => r.mvps },
  { id: 'victorias', titulo: 'Victorias', unidad: 'victorias', valor: (r) => r.victorias },
  {
    id: 'pct',
    titulo: '% victorias',
    unidad: '%',
    valor: (r) => (r.partidos >= MIN_PARTIDOS ? Math.round((100 * r.victorias) / r.partidos) : null),
    nota: `Hace falta haber jugado al menos ${MIN_PARTIDOS} partidos.`,
  },
  { id: 'partidos', titulo: 'Partidos', unidad: 'partidos', valor: (r) => r.partidos },
]

const MEDALLAS = ['🥇', '🥈', '🥉']

export default function Ranking({ yo }: { yo: any }) {
  const [filas, setFilas] = useState<any[] | null>(null)
  const [cat, setCat] = useState('goles')
  const [ficha, setFicha] = useState<string | null>(null)
  const [fallo, setFallo] = useState(false)

  useEffect(() => {
    if (ficha !== null) return
    ;(async () => {
      const [pr, rk] = await Promise.all([
        supabase.from('perfiles').select('*').eq('activo', true),
        supabase.rpc('ranking_jugadores'),
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
  }, [ficha])

  if (ficha !== null) return <Ficha id={ficha} yo={yo} onBack={() => setFicha(null)} />
  if (fallo) {
    return (
      <>
        <h2>Ranking</h2>
        <p className="mut">No se pudo cargar el ranking. Comprueba que se ha ejecutado el script 04_ranking.sql en Supabase.</p>
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
      <h2>Ranking</h2>
      <div className="chips">
        {CATEGORIAS.map((c) => (
          <button key={c.id} className={'sec' + (cat === c.id ? ' on2' : '')} onClick={() => setCat(c.id)}>
            {c.titulo}
          </button>
        ))}
      </div>
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
    </>
  )
}
