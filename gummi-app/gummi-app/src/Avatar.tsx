// Foto del jugador o, si no tiene, sus iniciales.
export default function Avatar({ p, size = 30 }: { p: any; size?: number }) {
  const ini = (p?.apodo || p?.nombre || '?').slice(0, size <= 28 ? 1 : 2).toUpperCase()
  if (p?.foto_url) {
    return <img className="avatar" src={p.foto_url} alt="" loading="lazy" style={{ width: size, height: size }} />
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {ini}
    </span>
  )
}
