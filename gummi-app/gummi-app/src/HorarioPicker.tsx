// Selector de horario del partido: día + hora de inicio + hora de fin, de media en media hora.
export type Horario = { fecha: string; ini: string; fin: string }

const pad = (n: number) => String(n).padStart(2, '0')
const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
const aHora = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

// Horas posibles de inicio: 07:00 a 23:00 (cada 30 min)
const INICIOS = Array.from({ length: 33 }, (_, i) => aHora(7 * 60 + i * 30))

export const horarioVacio = (): Horario => ({ fecha: '', ini: '14:00', fin: '15:00' })

export function aTimestamps(h: Horario): { fecha: string; fecha_fin: string } {
  return {
    fecha: new Date(`${h.fecha}T${h.ini}`).toISOString(),
    fecha_fin: new Date(`${h.fecha}T${h.fin}`).toISOString(),
  }
}

export function desdePartido(p: any): Horario {
  const d = new Date(p.fecha)
  const f = p.fecha_fin ? new Date(p.fecha_fin) : new Date(d.getTime() + 3600000)
  const fecha = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const redondea = (x: Date) => aHora(x.getHours() * 60 + (x.getMinutes() >= 15 && x.getMinutes() < 45 ? 30 : 0) + (x.getMinutes() >= 45 ? 60 : 0))
  return { fecha, ini: redondea(d), fin: redondea(f) }
}

export default function HorarioPicker({ valor, onChange }: { valor: Horario; onChange: (h: Horario) => void }) {
  const ini = aMin(valor.ini)
  // Fin: desde 30 min después hasta 4 h después (máximo 23:30)
  const fines: string[] = []
  for (let m = ini + 30; m <= Math.min(ini + 240, 23 * 60 + 30); m += 30) fines.push(aHora(m))

  const cambiaIni = (nuevo: string) => {
    const dur = Math.max(30, aMin(valor.fin) - ini)
    onChange({ ...valor, ini: nuevo, fin: aHora(Math.min(aMin(nuevo) + dur, 23 * 60 + 30)) })
  }
  const dur = aMin(valor.fin) - ini
  const durTxt = dur > 0 ? `${Math.floor(dur / 60) ? Math.floor(dur / 60) + ' h' : ''}${dur % 60 ? ' ' + (dur % 60) + ' min' : ''}`.trim() : ''

  return (
    <div className="horario">
      <input type="date" value={valor.fecha} onChange={(e) => onChange({ ...valor, fecha: e.target.value })} />
      <div className="horario-horas">
        <label>
          <span className="mut">Empieza</span>
          <select value={valor.ini} onChange={(e) => cambiaIni(e.target.value)}>
            {INICIOS.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
        <span className="horario-sep">→</span>
        <label>
          <span className="mut">Termina</span>
          <select value={valor.fin} onChange={(e) => onChange({ ...valor, fin: e.target.value })}>
            {!fines.includes(valor.fin) && <option value={valor.fin}>{valor.fin}</option>}
            {fines.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      </div>
      {durTxt && <div className="mut">Duración: {durTxt}</div>}
    </div>
  )
}
