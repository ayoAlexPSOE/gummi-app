import { useEffect, useRef, useState } from 'react'

// Número que "sube" desde 0 al aparecer (ligero: requestAnimationFrame, ~0,7 s).
export default function Numero({ v, sufijo = '' }: { v: number | null | undefined; sufijo?: string }) {
  const fin = typeof v === 'number' && isFinite(v) ? v : null
  const [n, setN] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    if (fin === null) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(fin); return }
    const t0 = performance.now(), dur = 700
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / dur)
      setN(Math.round(fin * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf.current = requestAnimationFrame(paso)
    }
    raf.current = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf.current)
  }, [fin])
  if (fin === null) return <>–</>
  return <>{n}{sufijo}</>
}
