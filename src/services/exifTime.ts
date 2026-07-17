/**
 * EXIF撮影時刻（DateTimeOriginal 0x9003）読取り
 *
 * gps.ts と同じ自前バイナリ解析パターン（依存追加なし）。
 * 既存の readExifGPS には触れず、独立モジュールとして分離。
 */

/** 撮影時刻を "YYYY/MM/DD HH:MM" 形式で返す。無ければ null */
export async function readExifDateTime(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buf = e.target?.result as ArrayBuffer
        resolve(parseExifDateTime(new DataView(buf)))
      } catch { resolve(null) }
    }
    reader.onerror = () => resolve(null)
    reader.readAsArrayBuffer(file.slice(0, 131072))
  })
}

function parseExifDateTime(v: DataView): string | null {
  if (v.getUint16(0) !== 0xFFD8) return null  // JPEG以外は対象外
  let o = 2
  while (o < v.byteLength - 2) {
    const m = v.getUint16(o)
    if (m === 0xFFE1) {
      const str = String.fromCharCode(...new Uint8Array(v.buffer, o + 4, 4))
      if (str === 'Exif') return parseIFDDateTime(v, o + 10)
    }
    if (m === 0xFFDA) break
    o += 2 + v.getUint16(o + 2)
  }
  return null
}

function parseIFDDateTime(v: DataView, base: number): string | null {
  try {
    const le = v.getUint16(base) === 0x4949
    const io = v.getUint32(base + 4, le)

    // IFD0 から ExifIFD ポインタ（0x8769）を探す
    const cnt = v.getUint16(base + io, le)
    let exifOff: number | null = null
    let dateTimeIfd0: string | null = null  // フォールバック: IFD0の0x0132(DateTime)
    for (let i = 0; i < cnt; i++) {
      const o = base + io + 2 + i * 12
      const tag = v.getUint16(o, le)
      if (tag === 0x8769) exifOff = v.getUint32(o + 8, le)
      if (tag === 0x0132) dateTimeIfd0 = readAscii(v, base, o, le)
    }

    // ExifIFD から DateTimeOriginal（0x9003）を探す
    if (exifOff !== null) {
      const ec = v.getUint16(base + exifOff, le)
      for (let i = 0; i < ec; i++) {
        const o = base + exifOff + 2 + i * 12
        if (v.getUint16(o, le) === 0x9003) {
          const s = readAscii(v, base, o, le)
          if (s) return formatExifDate(s)
        }
      }
    }
    return dateTimeIfd0 ? formatExifDate(dateTimeIfd0) : null
  } catch { return null }
}

/** IFDエントリ（ASCII型）の値を読む。4バイト超は値がオフセット参照になる */
function readAscii(v: DataView, base: number, entryOffset: number, le: boolean): string | null {
  const count = v.getUint32(entryOffset + 4, le)
  if (count <= 0 || count > 64) return null
  const src = count <= 4 ? entryOffset + 8 : base + v.getUint32(entryOffset + 8, le)
  if (src + count > v.byteLength) return null
  let s = ''
  for (let i = 0; i < count; i++) {
    const c = v.getUint8(src + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s || null
}

/** "YYYY:MM:DD HH:MM:SS" → "YYYY/MM/DD HH:MM"（不正形式はnull） */
function formatExifDate(s: string): string | null {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/)
  if (!m) return null
  return `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}`
}
