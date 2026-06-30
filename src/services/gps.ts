import type { LatLng } from '../types'

export async function readExifGPS(file: File): Promise<LatLng | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buf = e.target?.result as ArrayBuffer
        resolve(parseExifGPS(new DataView(buf)))
      } catch { resolve(null) }
    }
    reader.onerror = () => resolve(null)
    reader.readAsArrayBuffer(file.slice(0, 131072))
  })
}

function parseExifGPS(v: DataView): LatLng | null {
  if (v.getUint16(0) !== 0xFFD8) return null
  let o = 2
  while (o < v.byteLength - 2) {
    const m = v.getUint16(o)
    if (m === 0xFFE1) {
      const str = String.fromCharCode(...new Uint8Array(v.buffer, o + 4, 4))
      if (str === 'Exif') return parseIFD(v, o + 10)
    }
    if (m === 0xFFDA) break
    o += 2 + v.getUint16(o + 2)
  }
  return null
}

function parseIFD(v: DataView, base: number): LatLng | null {
  try {
    const le = v.getUint16(base) === 0x4949
    const io = v.getUint32(base + 4, le)
    const cnt = v.getUint16(base + io, le)
    let gp: number | null = null
    for (let i = 0; i < cnt; i++) {
      const o = base + io + 2 + i * 12
      if (v.getUint16(o, le) === 0x8825) gp = v.getUint32(o + 8, le)
    }
    if (gp === null) return null
    const gc = v.getUint16(base + gp, le)
    let la: number[] | null = null, lr = 'N'
    let lo: number[] | null = null, lre = 'E'
    for (let i = 0; i < gc; i++) {
      const o = base + gp + 2 + i * 12
      const tag = v.getUint16(o, le)
      const vo = v.getUint32(o + 8, le)
      if (tag === 1) lr = String.fromCharCode(v.getUint8(o + 8))
      else if (tag === 2) la = readRationals(v, base + vo, 3, le)
      else if (tag === 3) lre = String.fromCharCode(v.getUint8(o + 8))
      else if (tag === 4) lo = readRationals(v, base + vo, 3, le)
    }
    if (!la || !lo) return null
    let lat = la[0] + la[1] / 60 + la[2] / 3600
    let lng = lo[0] + lo[1] / 60 + lo[2] / 3600
    if (lr === 'S') lat = -lat
    if (lre === 'W') lng = -lng
    return isNaN(lat) || isNaN(lng) ? null : { lat, lng }
  } catch { return null }
}

function readRationals(v: DataView, o: number, n: number, le: boolean): number[] {
  const a: number[] = []
  for (let i = 0; i < n; i++) {
    const d = v.getUint32(o + i * 8 + 4, le)
    a.push(d ? v.getUint32(o + i * 8, le) / d : 0)
  }
  return a
}
