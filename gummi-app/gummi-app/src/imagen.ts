// Imagen para compartir (resultado o equipos de un partido), dibujada en el móvil con <canvas>.
import fondoUrl from './estrellas.svg'
import logoUrl from './logo.webp'

export type EquipoImg = { nombre: string; hex: string | null; jugadores: { nombre: string; g: number; a: number }[] }
export type DatosImg = {
  modo: 'resultado' | 'equipos'
  fecha: string
  lugar?: string | null
  a: EquipoImg
  b: EquipoImg
  golesA?: number | null
  golesB?: number | null
  mvp?: string | null
}

const W = 1080
const H = 1350
const FUENTE = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

function cargarImagen(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = () => ok(null)
    i.src = src
  })
}

// Camiseta (misma silueta que en la app), centrada en (x, y) con ancho w
function camiseta(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, hex: string) {
  const s = w / 24
  ctx.save()
  ctx.translate(x - 12 * s, y - 11 * s)
  ctx.scale(s, s)
  const p = new Path2D('M8 1 L1 5 L3.5 10 L6 9 V21 H18 V9 L20.5 10 L23 5 L16 1 C15 3 13.6 4 12 4 C10.4 4 9 3 8 1 Z')
  ctx.fillStyle = hex
  ctx.fill(p)
  ctx.lineWidth = 0.7
  ctx.strokeStyle = 'rgba(255,255,255,.75)'
  ctx.stroke(p)
  ctx.restore()
}

function texto(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, tam: number, peso = 700, color = '#f2f5ff', alin: CanvasTextAlign = 'center', max?: number) {
  ctx.font = `${peso} ${tam}px ${FUENTE}`
  ctx.fillStyle = color
  ctx.textAlign = alin
  ctx.textBaseline = 'alphabetic'
  let s = t
  if (max) while (s.length > 1 && ctx.measureText(s).width > max) s = s.slice(0, -2) + '…'
  ctx.fillText(s, x, y)
}

export async function dibujarImagen(d: DatosImg): Promise<Blob> {
  try { await (document as any).fonts?.ready } catch { /* */ }
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d') as CanvasRenderingContext2D

  // Fondo: azul noche + estrellas de la app + velo
  ctx.fillStyle = '#040826'
  ctx.fillRect(0, 0, W, H)
  const [fondo, logo] = await Promise.all([cargarImagen(fondoUrl), cargarImagen(logoUrl)])
  if (fondo) {
    const esc = Math.max(W / fondo.width, H / fondo.height)
    ctx.drawImage(fondo, (W - fondo.width * esc) / 2, (H - fondo.height * esc) / 2, fondo.width * esc, fondo.height * esc)
  }
  const velo = ctx.createLinearGradient(0, 0, 0, H)
  velo.addColorStop(0, 'rgba(4,8,38,.35)')
  velo.addColorStop(0.45, 'rgba(4,8,38,.72)')
  velo.addColorStop(1, 'rgba(4,8,38,.9)')
  ctx.fillStyle = velo
  ctx.fillRect(0, 0, W, H)

  // Logo y fecha
  if (logo) {
    const lw = 300
    ctx.drawImage(logo, (W - lw) / 2, 60, lw, (lw * logo.height) / logo.width)
  }
  texto(ctx, d.modo === 'resultado' ? 'RESULTADO' : 'EQUIPOS DEL PARTIDO', W / 2, 375, 30, 700, '#9feeff')
  texto(ctx, d.fecha, W / 2, 425, 38, 700, '#f2f5ff', 'center', W - 120)
  if (d.lugar) texto(ctx, '📍 ' + d.lugar, W / 2, 472, 28, 500, '#a3b0e6', 'center', W - 120)

  const colA = d.a.hex || '#3ddcff'
  const colB = d.b.hex || '#ff6fe0'
  let y = 560

  if (d.modo === 'resultado') {
    // Marcador
    camiseta(ctx, 230, y + 40, 120, colA)
    camiseta(ctx, W - 230, y + 40, 120, colB)
    texto(ctx, d.a.nombre.toUpperCase(), 230, y + 150, 34, 800, '#f2f5ff', 'center', 300)
    texto(ctx, d.b.nombre.toUpperCase(), W - 230, y + 150, 34, 800, '#f2f5ff', 'center', 300)
    texto(ctx, `${d.golesA ?? 0}`, W / 2 - 105, y + 110, 150, 800)
    texto(ctx, `${d.golesB ?? 0}`, W / 2 + 105, y + 110, 150, 800)
    texto(ctx, '–', W / 2, y + 95, 90, 700, '#a3b0e6')
    y += 230
    // Goleadores de cada equipo
    const linea = (e: EquipoImg, x: number, alin: CanvasTextAlign) => {
      let yy = y
      for (const j of e.jugadores.filter((j) => j.g > 0 || j.a > 0).sort((p, q) => q.g - p.g || q.a - p.a).slice(0, 7)) {
        const extra = `${j.g > 0 ? ' ⚽' + (j.g > 1 ? '×' + j.g : '') : ''}${j.a > 0 ? ' 🅰️' + (j.a > 1 ? '×' + j.a : '') : ''}`
        texto(ctx, j.nombre + extra, x, yy, 32, 600, '#e6ecff', alin, 440)
        yy += 48
      }
    }
    linea(d.a, 90, 'left')
    linea(d.b, W - 90, 'right')
    if (d.mvp) {
      const ym = H - 190
      ctx.fillStyle = 'rgba(255,200,61,.14)'
      ctx.strokeStyle = 'rgba(255,200,61,.55)'
      ctx.lineWidth = 2
      ctx.beginPath(); (ctx as any).roundRect?.(160, ym - 58, W - 320, 84, 42); ctx.fill(); ctx.stroke()
      texto(ctx, '👑 MVP: ' + d.mvp, W / 2, ym, 38, 800, '#ffd76a', 'center', W - 360)
    }
  } else {
    // Alineaciones en dos columnas
    const col = (e: EquipoImg, cx: number, hex: string) => {
      camiseta(ctx, cx, y + 20, 90, hex)
      texto(ctx, e.nombre.toUpperCase(), cx, y + 115, 36, 800, '#f2f5ff', 'center', 420)
      let yy = y + 185
      for (const j of e.jugadores.slice(0, 10)) {
        texto(ctx, j.nombre, cx, yy, 34, 600, '#e6ecff', 'center', 420)
        yy += 54
      }
    }
    col(d.a, W / 4 + 10, colA)
    col(d.b, (3 * W) / 4 - 10, colB)
    ctx.strokeStyle = 'rgba(255,255,255,.15)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(W / 2, y + 140); ctx.lineTo(W / 2, H - 160); ctx.stroke()
  }

  texto(ctx, 'gummi · la app de la peña', W / 2, H - 60, 26, 500, 'rgba(163,176,230,.8)')
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error('No se pudo crear la imagen'))), 'image/png'))
}

// Comparte la imagen (menú del móvil: WhatsApp, Instagram…) o la descarga si no se puede.
export async function compartirImagen(d: DatosImg, nombreArchivo = 'gummi-partido.png') {
  const blob = await dibujarImagen(d)
  const file = new File([blob], nombreArchivo, { type: 'image/png' })
  const nav: any = navigator
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file] }); return } catch (e: any) { if (e?.name === 'AbortError') return }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500)
}
