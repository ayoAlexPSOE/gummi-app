// Posiciones de fútbol 7 y colores de camiseta de los equipos.

export const POSICIONES: [string, string, string, string][] = [
  // id, nombre, icono, abreviatura
  ['portero', 'Portero', '🧤', 'POR'],
  ['defensa', 'Defensa', '🛡️', 'DEF'],
  ['medio', 'Medio', '🎯', 'MED'],
  ['banda', 'Banda', '🏃', 'BAN'],
  ['delantero', 'Delantero', '⚡', 'DEL'],
]
export const nombrePos = (p?: string | null) => POSICIONES.find((x) => x[0] === p)?.[1] || p || ''
export const abrevPos = (p?: string | null) => POSICIONES.find((x) => x[0] === p)?.[3] || (p || '').slice(0, 3).toUpperCase()

// Colores de camiseta: los que casi todo el mundo tiene en casa.
// hex = color de la camiseta; ui = color para pintarlo sobre el fondo oscuro de la app.
export type Color = { id: string; nombre: string; plural: string; hex: string; ui: string; emoji: string }
export const COLORES: Color[] = [
  { id: 'blanco', nombre: 'Blanco', plural: 'Blancos', hex: '#f4f6fb', ui: '#f4f6fb', emoji: '⚪' },
  { id: 'negro', nombre: 'Negro', plural: 'Negros', hex: '#16181f', ui: '#9aa3b8', emoji: '⚫' },
  { id: 'rojo', nombre: 'Rojo', plural: 'Rojos', hex: '#e53946', ui: '#ff5a66', emoji: '🔴' },
  { id: 'azul', nombre: 'Azul', plural: 'Azules', hex: '#2f6bff', ui: '#5b8cff', emoji: '🔵' },
  { id: 'amarillo', nombre: 'Amarillo', plural: 'Amarillos', hex: '#ffd23f', ui: '#ffd23f', emoji: '🟡' },
  { id: 'verde', nombre: 'Verde', plural: 'Verdes', hex: '#22b45a', ui: '#3fd77a', emoji: '🟢' },
  { id: 'naranja', nombre: 'Naranja', plural: 'Naranjas', hex: '#ff8a2a', ui: '#ff9a45', emoji: '🟠' },
  { id: 'gris', nombre: 'Gris', plural: 'Grises', hex: '#8a919e', ui: '#b4bac6', emoji: '🩶' },
]
export const color = (id?: string | null) => COLORES.find((c) => c.id === id) || null

// Parejas que se distinguen de un vistazo, de más fácil de conseguir a menos.
const PAREJAS: [string, string][] = [
  ['blanco', 'negro'], ['blanco', 'azul'], ['rojo', 'azul'], ['blanco', 'rojo'],
  ['amarillo', 'negro'], ['naranja', 'azul'], ['verde', 'blanco'],
]
// Colores que se confunden entre sí: no se dejan poner juntos.
const PARECIDOS = [['negro', 'azul'], ['rojo', 'naranja'], ['amarillo', 'naranja'], ['blanco', 'gris'], ['negro', 'gris'], ['verde', 'azul']]
export const seParecen = (a: string, b: string) => a === b || PARECIDOS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

// Al generar equipos: casi siempre blanco contra negro; a veces otra pareja clásica.
export function elegirColores(): [string, string] {
  const r = Math.random()
  const par = r < 0.6 ? PAREJAS[0] : PAREJAS[1 + Math.floor(Math.random() * 3)]
  return Math.random() < 0.5 ? par : [par[1], par[0]]
}

// Nombre del equipo: "Blancos" si tiene color; si no, "Equipo A".
export const nombreEquipo = (letra: 'A' | 'B', idColor?: string | null) => color(idColor)?.plural || `Equipo ${letra}`
