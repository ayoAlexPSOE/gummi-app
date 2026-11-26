import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Ficha from './Ficha'
import Logros from './Logros'
import Avatar from './Avatar'
import { Cargando, useAtras } from './movil'

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
  useAtras(ficha !== null, () => setFicha(null))

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
  if (!filas) return <Cargando />

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
      <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ margin: '8px 0 4px', width: '100%' }} aria-label="Temporada">
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
        <div className="vacio"><span>{actual.icono}</span><b>Todavía no hay datos</b><div className="mut">Aparecerán al jugarse y cerrarse los primeros partidos.</div></div>
      )}
      {ordenados.length >= 3 && (
        <div className="podio">
          {[1, 0, 2].map((i) => {
            const x = ordenados[i]
            return (
              <div key={x.r.id} className={'podio-p p' + (i + 1) + (x.r.id === yo.id ? ' yo' : '')} onClick={() => setFicha(x.r.id)}>
                <div className="podio-foto">
                  <span className="podio-medalla">{MEDALLAS[puestos[i] - 1] || puestos[i]}</span>
                  <Avatar p={x.r} size={i === 0 ? 60 : 48} />
                </div>
                <div className="podio-n">{x.r.apodo || x.r.nombre}</div>
                <div className="podio-v">{x.v}<span> {actual.unidad}</span></div>
                <div className="podio-base">{puestos[i]}</div>
              </div>
            )
          })}
        </div>
      )}
      {ordenados.map((x, i) => (ordenados.length >= 3 && i < 3) ? null : (
        <div className={'card row rank-fila' + (x.r.id === yo.id ? ' yo' : '')} key={x.r.id} onClick={() => setFicha(x.r.id)}>
          <span className="rank-pos">
            {puestos[i] <= 3 ? MEDALLAS[puestos[i] - 1] : puestos[i]}
          </span>
          <Avatar p={x.r} size={36} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>{x.r.apodo || x.r.nombre}</b>
            {x.r.es_externo && <span className="tag" style={{ marginLeft: 6 }}>ext</span>}
            <div className="mut">{x.r.partidos} PJ · {x.r.victorias}V {x.r.empates}E {x.r.derrotas}D</div>
          </span>
          <span className="rank-val">
            {x.v}
            <span className="mut"> {actual.unidad}</span>
          </span>
        </div>
      ))}

    </>
  )
}
