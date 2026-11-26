// Placa con la media del jugador (0-99), con color según nivel, al estilo de las cartas.
// Por ahora solo la ve el admin; está lista por si algún día se hace pública.
export const nivel = (n: number) => (n >= 85 ? 'toty' : n >= 75 ? 'oro' : n >= 65 ? 'plata' : 'bronce')

export default function Media({ nota, grande = false }: { nota: number | null | undefined; grande?: boolean }) {
  if (nota == null) return <span className="media vacia" title="Sin media todavía">–</span>
  const n = Math.round(Number(nota))
  return (
    <span className={'media ' + nivel(n) + (grande ? ' grande' : '')} title={`Media ${n} (solo la ves tú)`} aria-label={`Media ${n}`}>
      <b>{n}</b>
      <i>MEDIA</i>
    </span>
  )
}
