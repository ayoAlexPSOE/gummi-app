// Versión de la app (viene de package.json al compilar).
// Cómo subirla: arreglos pequeños -> 0.9.1, 0.9.2…; algo nuevo -> 0.10.0; salida oficial con los usuarios reales -> 1.0.0
declare const __VERSION__: string
export const VERSION = __VERSION__
export const FIRMA = `by alexc · v${VERSION}`
